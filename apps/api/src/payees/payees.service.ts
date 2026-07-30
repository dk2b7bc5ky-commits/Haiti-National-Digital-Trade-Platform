import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ChargeType, Payee, PayeeType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { payeeTypeToApi } from '../charges/mappers';
import { CreatePayeeDto } from './dto';
import type { PayeeSummary } from '@rezo/shared-types';

/** Maps a charge type to the kind of payee that receives it. */
export function payeeTypeForCharge(type: ChargeType): PayeeType {
  switch (type) {
    case 'CUSTOMS_DUTY':
    case 'CUSTOMS_FEE':
    case 'INSPECTION':
      return 'CUSTOMS';
    case 'PORT_DUES':
    case 'SCANNING':
      return 'PORT';
    case 'TERMINAL_HANDLING':
    case 'STORAGE':
    case 'DEMURRAGE':
    case 'DETENTION':
      return 'TERMINAL';
    case 'REZO_FEE':
      return 'REZO';
    default:
      return 'OTHER';
  }
}

@Injectable()
export class PayeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  toSummary(p: Payee): PayeeSummary {
    return { id: p.id, org_id: p.orgId, name: p.name, type: payeeTypeToApi(p.type), active: p.active };
  }

  async list(): Promise<PayeeSummary[]> {
    const rows = await this.prisma.payee.findMany({ orderBy: { name: 'asc' } });
    return rows.map((p) => this.toSummary(p));
  }

  /** First active payee of a given type (used to attribute charges). */
  async resolveByType(type: PayeeType): Promise<Payee | null> {
    return this.prisma.payee.findFirst({ where: { type, active: true } });
  }

  async create(principal: AuthPrincipal, dto: CreatePayeeDto): Promise<PayeeSummary> {
    const org = await this.prisma.organization.findUnique({ where: { id: dto.org_id } });
    if (!org) throw new NotFoundException('Payee organization not found.');

    const type = dto.type.toUpperCase() as PayeeType;
    const existing = await this.prisma.payee.findUnique({
      where: { orgId_type: { orgId: dto.org_id, type } },
    });
    if (existing) throw new ConflictException('A payee of that type already exists for this org.');

    const payee = await this.prisma.payee.create({
      data: {
        orgId: dto.org_id,
        name: dto.name,
        type,
        settlementRef: dto.settlement_ref,
        active: dto.active ?? true,
      },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'payee.create',
      entity: 'Payee',
      entityId: payee.id,
      after: { org_id: payee.orgId, type: payee.type, name: payee.name },
    });
    return this.toSummary(payee);
  }
}
