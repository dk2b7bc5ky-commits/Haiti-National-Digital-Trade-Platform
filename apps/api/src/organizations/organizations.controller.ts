import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OrgType } from '@prisma/client';
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

  // Must be declared before ':id' so "directory" isn't captured as an id.
  @Get('directory')
  @RequirePermissions(Permission.ORG_READ)
  directory(@Query('type') type?: string) {
    const parsed = type && type in OrgType ? (type as OrgType) : undefined;
    return this.orgs.directory(parsed);
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
