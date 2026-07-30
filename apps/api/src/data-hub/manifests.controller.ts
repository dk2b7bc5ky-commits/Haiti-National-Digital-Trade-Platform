import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ManifestsService } from './manifests.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { normalizeLimit } from '../common/pagination';
import { SubmitManifestDto } from './dto';

@Controller('manifests')
export class ManifestsController {
  constructor(private readonly manifests: ManifestsService) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions(Permission.MANIFEST_SUBMIT)
  submit(@CurrentUser() principal: AuthPrincipal, @Body() dto: SubmitManifestDto) {
    return this.manifests.submit(principal, dto);
  }

  @Get()
  @RequirePermissions(Permission.CONTAINER_READ)
  list(
    @CurrentUser() principal: AuthPrincipal,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.manifests.list(principal, normalizeLimit(limit), cursor);
  }

  @Get(':id')
  @RequirePermissions(Permission.CONTAINER_READ)
  getById(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    return this.manifests.getById(principal, id);
  }
}
