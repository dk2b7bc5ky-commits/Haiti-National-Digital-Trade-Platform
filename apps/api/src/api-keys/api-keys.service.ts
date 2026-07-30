import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../auth/auth-principal';
import { cursorArgs, splitPage, Paginated } from '../common/pagination';
import { CreateApiKeyDto } from './dto';
import type { ApiKeyCreated } from '@rezo/shared-types';

export interface ApiKeyListItem {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  status: string;
  created_at: string;
  last_used_at: string | null;
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates an API key for the caller's own org. The plaintext key is returned
   * exactly once; only its SHA-256 hash is persisted.
   */
  async create(principal: AuthPrincipal, dto: CreateApiKeyDto): Promise<ApiKeyCreated> {
    const secret = randomBytes(24).toString('base64url');
    const prefix = `rzk_${randomBytes(4).toString('hex')}`;
    const plaintext = `${prefix}.${secret}`;
    const keyHash = createHash('sha256').update(plaintext).digest('hex');

    const record = await this.prisma.apiKey.create({
      data: {
        orgId: principal.orgId,
        name: dto.name,
        prefix,
        keyHash,
        scopes: dto.scopes ?? [],
      },
    });

    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'apikey.create',
      entity: 'ApiKey',
      entityId: record.id,
      after: { prefix: record.prefix, scopes: record.scopes },
    });

    return {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      scopes: record.scopes,
      api_key: plaintext,
    };
  }

  async list(
    principal: AuthPrincipal,
    limit: number,
    cursor?: string,
  ): Promise<Paginated<ApiKeyListItem>> {
    const rows = await this.prisma.apiKey.findMany({
      where: { orgId: principal.orgId },
      orderBy: { createdAt: 'asc' },
      ...cursorArgs(limit, cursor),
    });
    const { items, nextCursor } = splitPage(rows, limit);
    return new Paginated(
      items.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        scopes: k.scopes,
        status: k.status,
        created_at: k.createdAt.toISOString(),
        last_used_at: k.lastUsedAt?.toISOString() ?? null,
      })),
      nextCursor,
    );
  }

  /** Revokes a key belonging to the caller's own org. */
  async revoke(principal: AuthPrincipal, id: string): Promise<{ id: string; status: string }> {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key || key.orgId !== principal.orgId) {
      throw new NotFoundException('API key not found.');
    }
    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: { status: 'REVOKED' },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      actorOrgId: principal.orgId,
      action: 'apikey.revoke',
      entity: 'ApiKey',
      entityId: id,
      before: { status: key.status },
      after: { status: updated.status },
    });
    return { id: updated.id, status: updated.status };
  }
}
