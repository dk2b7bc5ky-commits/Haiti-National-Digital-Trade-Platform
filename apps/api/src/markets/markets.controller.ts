import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { MarketsService } from './markets.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { UpdateMarketDto } from './dto';

@Controller('markets')
export class MarketsController {
  constructor(private readonly markets: MarketsService) {}

  // Any authenticated user may read market config (currencies, tariff, modules).
  @Get()
  list() {
    return this.markets.list();
  }

  @Get(':code')
  get(@Param('code') code: string) {
    return this.markets.get(code.toUpperCase());
  }

  @Patch(':code')
  @RequirePermissions(Permission.CONFIG_MANAGE)
  update(
    @CurrentUser() principal: AuthPrincipal,
    @Param('code') code: string,
    @Body() dto: UpdateMarketDto,
  ) {
    return this.markets.update(principal, code.toUpperCase(), dto);
  }
}
