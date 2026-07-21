import { Injectable, NotFoundException } from '@nestjs/common';
import { ContainerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { cursorArgs, splitPage, Paginated } from '../common/pagination';
import { containerScopeWhere } from './scoping';
import {
  containerInclude,
  containerDetailInclude,
  toContainerSummary,
  toContainerDetail,
} from './mappers';
import type { ContainerSummary, ContainerDetail, ContainerStatus as ApiStatus } from '@rezo/shared-types';

const API_TO_STATUS: Record<ApiStatus, ContainerStatus> = {
  arrived: 'ARRIVED',
  cleared: 'CLEARED',
  released: 'RELEASED',
  gated_out: 'GATED_OUT',
};

export interface ContainerFilters {
  importerOrgId?: string;
  terminalOrgId?: string;
  status?: string;
}

@Injectable()
export class ContainersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    principal: AuthPrincipal,
    filters: ContainerFilters,
    limit: number,
    cursor?: string,
  ): Promise<Paginated<ContainerSummary>> {
    // Start from the caller's role scope, then apply optional query filters
    // (intersection — a filter can never widen visibility).
    const where: Prisma.ContainerWhereInput = { ...containerScopeWhere(principal) };
    if (filters.importerOrgId) where.importerOrgId = filters.importerOrgId;
    if (filters.terminalOrgId) where.terminalOrgId = filters.terminalOrgId;
    if (filters.status && filters.status in API_TO_STATUS) {
      where.status = API_TO_STATUS[filters.status as ApiStatus];
    }

    const rows = await this.prisma.container.findMany({
      where,
      include: containerInclude,
      orderBy: { createdAt: 'desc' },
      ...cursorArgs(limit, cursor),
    });
    const { items, nextCursor } = splitPage(rows, limit);
    return new Paginated(items.map(toContainerSummary), nextCursor);
  }

  async getById(principal: AuthPrincipal, id: string): Promise<ContainerDetail> {
    const container = await this.prisma.container.findFirst({
      where: { id, ...containerScopeWhere(principal) },
      include: containerDetailInclude,
    });
    if (!container) throw new NotFoundException('Container not found.');
    return toContainerDetail(container);
  }
}
