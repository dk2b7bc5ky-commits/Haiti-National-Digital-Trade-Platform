import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { FxService } from './fx.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { CreatePaymentRequestDto, AuthorizePaymentDto, SetFxRateDto } from './dto';
import type { RailOutcome } from '../integration/payment-rail';

@Controller('payment-requests')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions(Permission.PAYMENT_CREATE)
  create(
    @CurrentUser() principal: AuthPrincipal,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() dto: CreatePaymentRequestDto,
  ) {
    return this.payments.create(principal, idempotencyKey, dto);
  }

  @Post(':id/authorize')
  @HttpCode(200)
  @RequirePermissions(Permission.PAYMENT_AUTHORIZE)
  authorize(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: AuthorizePaymentDto,
  ) {
    return this.payments.authorize(principal, id, dto.simulate as Record<string, RailOutcome> | undefined);
  }

  @Get(':id')
  @RequirePermissions(Permission.PAYMENT_CREATE)
  get(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    return this.payments.get(principal, id);
  }
}

/** FX rate visibility + admin overrides (used to demonstrate the FX freeze). */
@Controller('fx-rates')
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Get()
  @RequirePermissions(Permission.PAYMENT_CREATE)
  list() {
    return this.fx.list();
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(Permission.CONFIG_MANAGE)
  async setRate(@Body() dto: SetFxRateDto & { rate: number }) {
    await this.fx.setRate(dto.base.toUpperCase(), dto.quote.toUpperCase(), Number(dto.rate), dto.source ?? 'manual');
    return { base: dto.base.toUpperCase(), quote: dto.quote.toUpperCase(), rate: Number(dto.rate) };
  }
}
