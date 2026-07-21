import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from './decorators';
import { AuthPrincipal, JwtClaims } from './auth-principal';
import { permissionsForRole } from '../rbac/permissions';

/**
 * Global guard: verifies the Bearer JWT and attaches the AuthPrincipal to the
 * request. Routes marked @Public() bypass it.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearer(request);
    if (!token) throw new UnauthorizedException('Missing bearer token.');

    let claims: JwtClaims;
    try {
      claims = await this.jwt.verifyAsync<JwtClaims>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }

    const principal: AuthPrincipal = {
      userId: claims.via_api_key ? null : claims.sub,
      orgId: claims.org_id,
      orgType: claims.org_type,
      role: claims.role,
      permissions: permissionsForRole(claims.role),
      viaApiKey: claims.via_api_key,
    };
    (request as Request & { user: AuthPrincipal }).user = principal;
    return true;
  }

  private extractBearer(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
