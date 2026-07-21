import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './decorators';
import { AuthPrincipal } from './auth-principal';
import { Permission } from '../rbac/permissions';

/**
 * Global guard (runs after JwtAuthGuard): enforces @RequirePermissions().
 * A route with no declared permissions is allowed for any authenticated user.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const principal: AuthPrincipal | undefined = request.user;
    if (!principal) throw new ForbiddenException('No authenticated principal.');

    const missing = required.filter((p) => !principal.permissions.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permission(s): ${missing.join(', ')}`);
    }
    return true;
  }
}
