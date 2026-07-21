import { Controller, Get, Param, Query } from '@nestjs/common';
import { ContainersService } from './containers.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { normalizeLimit } from '../common/pagination';

@Controller('containers')
export class ContainersController {
  constructor(private readonly containers: ContainersService) {}

  @Get()
  @RequirePermissions(Permission.CONTAINER_READ)
  list(
    @CurrentUser() principal: AuthPrincipal,
    @Query('importer_org_id') importerOrgId?: string,
    @Query('terminal_org_id') terminalOrgId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.containers.list(
      principal,
      { importerOrgId, terminalOrgId, status },
      normalizeLimit(limit),
      cursor,
    );
  }

  @Get(':id')
  @RequirePermissions(Permission.CONTAINER_READ)
  getById(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    return this.containers.getById(principal, id);
  }
}
