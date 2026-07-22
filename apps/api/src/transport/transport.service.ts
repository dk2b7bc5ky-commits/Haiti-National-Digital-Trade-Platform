import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GateAppointment, Prisma, TransportJob } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { MarketConfigService } from '../config/market-config.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { resolveContainerScope } from '../data-hub/scoping';
import { CreateTransportJobDto, CreateGateAppointmentDto, GpsDto } from './dto';
import type { TransportJobSummary, GateAppointmentSummary } from '@rezo/shared-types';

interface UploadedFile { originalname: string; mimetype: string; buffer: Buffer; }

const jobWithContainer = { container: { select: { containerNumber: true } } } as const;

@Injectable()
export class TransportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly config: MarketConfigService,
  ) {}

  private toJob(j: TransportJob & { container: { containerNumber: string } }): TransportJobSummary {
    return {
      id: j.id,
      container_id: j.containerId,
      container_number: j.container.containerNumber,
      trucker_org_id: j.truckerOrgId,
      pickup: j.pickup,
      dropoff: j.dropoff,
      price: j.price,
      currency: j.currency,
      status: j.status.toLowerCase() as TransportJobSummary['status'],
      insurance_ref: j.insuranceRef,
      pod_ref: j.podRef,
      gps: j.gpsLat != null && j.gpsLng != null ? { lat: j.gpsLat, lng: j.gpsLng, at: j.gpsAt?.toISOString() ?? '' } : null,
      created_at: j.createdAt.toISOString(),
    };
  }

  private toAppt(a: GateAppointment & { container: { containerNumber: string } }): GateAppointmentSummary {
    return {
      id: a.id,
      container_id: a.containerId,
      container_number: a.container.containerNumber,
      trucker_org_id: a.truckerOrgId,
      terminal_org_id: a.terminalOrgId,
      slot_time: a.slotTime.toISOString(),
      status: a.status.toLowerCase() as GateAppointmentSummary['status'],
      created_at: a.createdAt.toISOString(),
    };
  }

  // --- jobs ---

  async createJob(principal: AuthPrincipal, dto: CreateTransportJobDto): Promise<TransportJobSummary> {
    const container = await this.prisma.container.findFirst({
      where: { id: dto.container_id, ...(await resolveContainerScope(this.prisma, principal)) },
    });
    if (!container) throw new NotFoundException('Container not found.');
    if (dto.trucker_org_id) {
      const t = await this.prisma.organization.findUnique({ where: { id: dto.trucker_org_id } });
      if (!t || t.type !== 'TRUCKER') throw new BadRequestException('trucker_org_id is not a trucker.');
    }
    const currency = dto.currency ?? (await this.config.getMarket()).baseCurrency;
    const job = await this.prisma.transportJob.create({
      data: {
        containerId: container.id,
        createdByOrgId: principal.orgId,
        truckerOrgId: dto.trucker_org_id ?? null,
        pickup: dto.pickup,
        dropoff: dto.dropoff,
        price: dto.price,
        currency,
      },
      include: jobWithContainer,
    });
    await this.audit.record({ actorUserId: principal.userId, actorOrgId: principal.orgId, action: 'transport.job_create', entity: 'TransportJob', entityId: job.id });
    return this.toJob(job);
  }

  async listJobs(principal: AuthPrincipal): Promise<TransportJobSummary[]> {
    const rows = await this.prisma.transportJob.findMany({
      where: await this.jobWhere(principal),
      include: jobWithContainer,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((j) => this.toJob(j));
  }

  async accept(principal: AuthPrincipal, id: string): Promise<TransportJobSummary> {
    const job = await this.prisma.transportJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found.');
    if (job.status !== 'OFFERED') throw new BadRequestException('Job is no longer open.');
    if (job.truckerOrgId && job.truckerOrgId !== principal.orgId) {
      throw new ForbiddenException('This job is offered to another trucker.');
    }
    const updated = await this.prisma.transportJob.update({
      where: { id },
      data: { truckerOrgId: principal.orgId, status: 'ACCEPTED' },
      include: jobWithContainer,
    });
    await this.audit.record({ actorUserId: principal.userId, actorOrgId: principal.orgId, action: 'transport.job_accept', entity: 'TransportJob', entityId: id });
    return this.toJob(updated);
  }

  async uploadFile(principal: AuthPrincipal, id: string, kind: 'insurance' | 'pod', file: UploadedFile): Promise<TransportJobSummary> {
    if (!file?.buffer?.length) throw new BadRequestException('No file uploaded.');
    const job = await this.requireOwnJob(principal, id);
    const key = `transport/${id}/${kind}-${randomUUID()}-${file.originalname}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    const data: Prisma.TransportJobUpdateInput =
      kind === 'insurance' ? { insuranceRef: key } : { podRef: key, status: 'DELIVERED' };
    const updated = await this.prisma.transportJob.update({ where: { id: job.id }, data, include: jobWithContainer });
    await this.audit.record({ actorUserId: principal.userId, actorOrgId: principal.orgId, action: `transport.${kind}_upload`, entity: 'TransportJob', entityId: id });
    return this.toJob(updated);
  }

  async setGps(principal: AuthPrincipal, id: string, dto: GpsDto): Promise<TransportJobSummary> {
    const job = await this.requireOwnJob(principal, id);
    const status = job.status === 'ACCEPTED' ? 'IN_TRANSIT' : job.status;
    const updated = await this.prisma.transportJob.update({
      where: { id: job.id },
      data: { gpsLat: dto.lat, gpsLng: dto.lng, gpsAt: new Date(), status },
      include: jobWithContainer,
    });
    return this.toJob(updated);
  }

  // --- gate appointments ---

  async bookGate(principal: AuthPrincipal, dto: CreateGateAppointmentDto): Promise<GateAppointmentSummary> {
    const container = await this.prisma.container.findUnique({ where: { id: dto.container_id } });
    if (!container) throw new NotFoundException('Container not found.');

    // A trucker may book a gate for any container it has a job on; other roles
    // must have it in their normal container scope.
    let allowed: boolean;
    if (principal.orgType === 'TRUCKER') {
      allowed = !!(await this.prisma.transportJob.findFirst({
        where: { containerId: container.id, truckerOrgId: principal.orgId },
      }));
    } else {
      allowed = !!(await this.prisma.container.findFirst({
        where: { id: container.id, ...(await resolveContainerScope(this.prisma, principal)) },
      }));
    }
    if (!allowed) throw new NotFoundException('Container not found.');

    const truckerOrgId =
      principal.orgType === 'TRUCKER' ? principal.orgId : dto.trucker_org_id;
    if (!truckerOrgId) throw new BadRequestException('trucker_org_id is required.');
    const appt = await this.prisma.gateAppointment.create({
      data: {
        containerId: container.id,
        truckerOrgId,
        terminalOrgId: container.terminalOrgId,
        slotTime: new Date(dto.slot_time),
      },
      include: jobWithContainer,
    });
    await this.audit.record({ actorUserId: principal.userId, actorOrgId: principal.orgId, action: 'gate.book', entity: 'GateAppointment', entityId: appt.id });
    return this.toAppt(appt);
  }

  async listGate(principal: AuthPrincipal): Promise<GateAppointmentSummary[]> {
    const rows = await this.prisma.gateAppointment.findMany({
      where: await this.gateWhere(principal),
      include: jobWithContainer,
      orderBy: { slotTime: 'asc' },
    });
    return rows.map((a) => this.toAppt(a));
  }

  async setGateStatus(principal: AuthPrincipal, id: string, status: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED'): Promise<GateAppointmentSummary> {
    const appt = await this.prisma.gateAppointment.findUnique({ where: { id } });
    if (!appt) throw new NotFoundException('Appointment not found.');
    // Terminal confirms/completes its own gate; trucker may cancel its own.
    const isTerminal = principal.permissions.includes(Permission.GATE_MANAGE);
    const crossTenant = principal.permissions.includes(Permission.TENANT_READ_ALL);
    if (status === 'CANCELLED') {
      if (!crossTenant && appt.truckerOrgId !== principal.orgId && !isTerminal) throw new ForbiddenException('Not permitted.');
    } else if (!isTerminal && !crossTenant) {
      throw new ForbiddenException('Only the terminal can confirm or complete a slot.');
    }
    const updated = await this.prisma.gateAppointment.update({ where: { id }, data: { status }, include: jobWithContainer });

    // Completing the gate = the truck passed through → gated out, but only once
    // release has been authorized (spec §2.5).
    if (status === 'COMPLETED') {
      const container = await this.prisma.container.findUnique({ where: { id: appt.containerId } });
      if (container?.status === 'RELEASED') {
        await this.prisma.container.update({
          where: { id: container.id },
          data: { status: 'GATED_OUT', gatedOutAt: new Date() },
        });
      }
    }

    await this.audit.record({ actorUserId: principal.userId, actorOrgId: principal.orgId, action: `gate.${status.toLowerCase()}`, entity: 'GateAppointment', entityId: id });
    return this.toAppt(updated);
  }

  // --- scoping helpers ---

  private async requireOwnJob(principal: AuthPrincipal, id: string): Promise<TransportJob> {
    const job = await this.prisma.transportJob.findUnique({ where: { id } });
    const crossTenant = principal.permissions.includes(Permission.TENANT_READ_ALL);
    if (!job || (!crossTenant && job.truckerOrgId !== principal.orgId)) {
      throw new NotFoundException('Job not found.');
    }
    return job;
  }

  private async jobWhere(principal: AuthPrincipal): Promise<Prisma.TransportJobWhereInput> {
    if (principal.permissions.includes(Permission.TENANT_READ_ALL)) return {};
    if (principal.orgType === 'TRUCKER') {
      return { OR: [{ truckerOrgId: principal.orgId }, { truckerOrgId: null, status: 'OFFERED' }] };
    }
    if (principal.permissions.includes(Permission.TRANSPORT_MANAGE)) {
      return { container: await resolveContainerScope(this.prisma, principal) };
    }
    return { id: { in: [] } };
  }

  private async gateWhere(principal: AuthPrincipal): Promise<Prisma.GateAppointmentWhereInput> {
    if (principal.permissions.includes(Permission.TENANT_READ_ALL)) return {};
    if (principal.orgType === 'TERMINAL') return { terminalOrgId: principal.orgId };
    if (principal.orgType === 'TRUCKER') return { truckerOrgId: principal.orgId };
    if (principal.permissions.includes(Permission.TRANSPORT_MANAGE)) {
      return { container: await resolveContainerScope(this.prisma, principal) };
    }
    return { id: { in: [] } };
  }
}
