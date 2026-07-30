import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DeadlineService } from '../deadlines/deadline.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { resolveContainerScope } from '../data-hub/scoping';
import { toTaskSummary } from './mappers';
import { ResolveTaskDto } from './dto';
import type { VerificationTaskSummary } from '@rezo/shared-types';

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly deadlines: DeadlineService,
  ) {}

  /** Ops verification queue (spec §1.7). Scoped unless the caller is cross-tenant. */
  async listTasks(principal: AuthPrincipal, status: string | undefined, limit: number): Promise<VerificationTaskSummary[]> {
    const crossTenant = principal.permissions.includes('tenant:read_all' as never);
    const where: Prisma.VerificationTaskWhereInput = {
      ...(status ? { status: status.toUpperCase() as never } : { status: 'OPEN' }),
    };
    if (!crossTenant) {
      const visible = await this.prisma.container.findMany({
        where: await resolveContainerScope(this.prisma, principal),
        select: { id: true },
      });
      where.containerId = { in: visible.map((c) => c.id) };
    }

    const tasks = await this.prisma.verificationTask.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    const numbers = await this.containerNumbers(tasks.map((t) => t.containerId));
    return tasks.map((t) => toTaskSummary({ ...t, containerNumber: t.containerId ? numbers.get(t.containerId) ?? null : null }));
  }

  /**
   * Resolve a task (spec §1.3): Ops confirms or corrects the value. The linked
   * charge moves out of PENDING_REVIEW into the payable total; before/after are
   * captured in the audit log.
   */
  async resolve(principal: AuthPrincipal, id: string, dto: ResolveTaskDto): Promise<VerificationTaskSummary> {
    const task = await this.prisma.verificationTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Verification task not found.');
    if (task.status !== 'OPEN') throw new BadRequestException('Task is already resolved.');

    let correctedAmount: number | null = null;
    let containerId: string | null = task.containerId;

    if (task.chargeId) {
      const charge = await this.prisma.charge.findUnique({ where: { id: task.chargeId } });
      if (charge) {
        containerId = charge.containerId;
        correctedAmount = dto.corrected_value ?? charge.amount;
        await this.prisma.charge.update({
          where: { id: charge.id },
          data: { amount: correctedAmount, status: 'PENDING', reviewState: 'RESOLVED' },
        });
      }
    }

    const after = { field: dto.field ?? task.field, amount: correctedAmount };
    const resolved = await this.prisma.verificationTask.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        afterValue: after,
        resolvedByUserId: principal.userId,
        resolvedAt: new Date(),
      },
    });

    // If the document has no more open tasks, mark it verified.
    if (task.documentId) {
      const remaining = await this.prisma.verificationTask.count({
        where: { documentId: task.documentId, status: 'OPEN' },
      });
      if (remaining === 0) {
        await this.prisma.document.update({
          where: { id: task.documentId },
          data: { verificationStatus: 'VERIFIED' },
        });
      }
    }

    if (containerId) await this.deadlines.recomputeForContainer(containerId);

    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'verification.resolve',
      entity: 'VerificationTask',
      entityId: id,
      before: task.beforeValue as Prisma.InputJsonValue,
      after,
    });

    const number = containerId ? (await this.containerNumbers([containerId])).get(containerId) ?? null : null;
    return toTaskSummary({ ...resolved, containerNumber: number });
  }

  private async containerNumbers(ids: (string | null)[]): Promise<Map<string, string>> {
    const clean = [...new Set(ids.filter((x): x is string => !!x))];
    if (clean.length === 0) return new Map();
    const rows = await this.prisma.container.findMany({
      where: { id: { in: clean } },
      select: { id: true, containerNumber: true },
    });
    return new Map(rows.map((r) => [r.id, r.containerNumber]));
  }
}
