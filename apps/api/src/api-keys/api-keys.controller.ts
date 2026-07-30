import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { normalizeLimit } from '../common/pagination';
import { CreateApiKeyDto } from './dto';

@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @RequirePermissions(Permission.APIKEY_MANAGE)
  list(
    @CurrentUser() principal: AuthPrincipal,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.apiKeys.list(principal, normalizeLimit(limit), cursor);
  }

  @Post()
  @RequirePermissions(Permission.APIKEY_MANAGE)
  create(@CurrentUser() principal: AuthPrincipal, @Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(principal, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.APIKEY_MANAGE)
  revoke(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    return this.apiKeys.revoke(principal, id);
  }
}
