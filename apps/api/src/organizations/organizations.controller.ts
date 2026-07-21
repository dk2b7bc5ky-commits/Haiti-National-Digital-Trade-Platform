import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { normalizeLimit } from '../common/pagination';
import { CreateOrganizationDto } from './dto';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get()
  @RequirePermissions(Permission.ORG_READ)
  list(
    @CurrentUser() principal: AuthPrincipal,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.orgs.list(principal, normalizeLimit(limit), cursor);
  }

  @Get(':id')
  @RequirePermissions(Permission.ORG_READ)
  getById(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    return this.orgs.getById(principal, id);
  }

  @Post()
  @RequirePermissions(Permission.ORG_WRITE)
  create(@CurrentUser() principal: AuthPrincipal, @Body() dto: CreateOrganizationDto) {
    return this.orgs.create(principal, dto);
  }
}
