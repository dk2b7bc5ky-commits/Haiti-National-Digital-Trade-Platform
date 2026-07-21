import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { permissionsForRole, defaultRoleForOrgType } from '../rbac/permissions';
import { toOrgSummary, toUserSummary } from '../common/mappers';
import { JwtClaims, AuthPrincipal } from './auth-principal';
import type { LoginResponse, TokenResponse, AuthContext } from '@rezo/shared-types';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /** Email + password login → signed JWT + auth context. */
  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { org: true },
    });
    // Constant-ish path: always compare against something to reduce user enumeration.
    const ok =
      user && user.status === 'ACTIVE'
        ? await bcrypt.compare(password, user.passwordHash)
        : await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinv');
    if (!user || !ok) {
      throw new UnauthorizedException('Invalid credentials.');
    }
    if (user.org.status !== 'ACTIVE') {
      throw new UnauthorizedException('Organization is suspended.');
    }

    const claims: JwtClaims = {
      sub: user.id,
      org_id: user.orgId,
      org_type: user.org.type,
      role: user.role,
      via_api_key: false,
    };
    const token = await this.jwt.signAsync(claims);

    await this.audit.record({
      actorUserId: user.id,
      actorOrgId: user.orgId,
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
    });

    return {
      token,
      user: toUserSummary(user),
      org: toOrgSummary(user.org),
      permissions: permissionsForRole(user.role),
    };
  }

  /** Exchange an API key for a short-lived JWT (spec §15 — API-connected orgs). */
  async exchangeApiKey(plaintext: string): Promise<TokenResponse> {
    const keyHash = createHash('sha256').update(plaintext).digest('hex');
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: { org: true },
    });
    if (!apiKey || apiKey.status !== 'ACTIVE' || apiKey.org.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid API key.');
    }

    const role = defaultRoleForOrgType(apiKey.org.type);
    const claims: JwtClaims = {
      sub: `apikey:${apiKey.id}`,
      org_id: apiKey.orgId,
      org_type: apiKey.org.type,
      role,
      via_api_key: true,
    };
    const token = await this.jwt.signAsync(claims);

    await this.prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });
    await this.audit.record({
      actorOrgId: apiKey.orgId,
      action: 'auth.apikey_exchange',
      entity: 'ApiKey',
      entityId: apiKey.id,
    });

    return { token };
  }

  /** Resolves the current principal into the full auth context for GET /auth/me. */
  async me(principal: AuthPrincipal): Promise<AuthContext> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: principal.orgId },
    });
    const permissions = permissionsForRole(principal.role);

    if (principal.userId) {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: principal.userId },
      });
      return { user: toUserSummary(user), org: toOrgSummary(org), permissions };
    }

    // API-key principal has no human user; synthesize a lightweight summary.
    return {
      user: {
        id: 'api-key',
        org_id: org.id,
        name: `${org.legalName} (API key)`,
        email: '',
        role: principal.role,
        status: 'ACTIVE',
      },
      org: toOrgSummary(org),
      permissions,
    };
  }
}
