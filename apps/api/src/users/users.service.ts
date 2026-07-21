import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal, tenantScope } from '../auth/auth-principal';
import { toUserSummary } from '../common/mappers';
import { cursorArgs, splitPage, Paginated } from '../common/pagination';
import { CreateUserDto } from './dto';
import type { UserSummary } from '@rezo/shared-types';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Lists users in the caller's tenant scope. */
  async list(
    principal: AuthPrincipal,
    limit: number,
    cursor?: string,
  ): Promise<Paginated<UserSummary>> {
    const scope = tenantScope(principal);
    const rows = await this.prisma.user.findMany({
      where: scope, // { orgId } or {} for cross-tenant
      orderBy: { createdAt: 'asc' },
      ...cursorArgs(limit, cursor),
    });
    const { items, nextCursor } = splitPage(rows, limit);
    return new Paginated(items.map(toUserSummary), nextCursor);
  }

  async create(principal: AuthPrincipal, dto: CreateUserDto): Promise<UserSummary> {
    const org = await this.prisma.organization.findUnique({ where: { id: dto.org_id } });
    if (!org) throw new NotFoundException('Target organization not found.');

    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('A user with that email already exists.');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        orgId: dto.org_id,
        name: dto.name,
        email,
        role: dto.role,
        passwordHash,
      },
    });

    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'user.create',
      entity: 'User',
      entityId: user.id,
      after: { org_id: user.orgId, email: user.email, role: user.role },
    });

    return toUserSummary(user);
  }
}
