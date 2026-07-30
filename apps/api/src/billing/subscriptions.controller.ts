import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { CreateSubscriptionDto } from './subscriptions.dto';

@Controller('subscription-plans')
export class SubscriptionPlansController {
  constructor(private readonly subs: SubscriptionsService) {}

  // Plan catalogue is readable by any authenticated user.
  @Get()
  plans() {
    return this.subs.plans();
  }
}

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get()
  @RequirePermissions(Permission.ORG_READ)
  list(@CurrentUser() principal: AuthPrincipal) {
    return this.subs.list(principal);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(Permission.CONFIG_MANAGE)
  create(@CurrentUser() principal: AuthPrincipal, @Body() dto: CreateSubscriptionDto) {
    return this.subs.create(principal, dto);
  }

  @Post(':id/renew')
  @HttpCode(200)
  @RequirePermissions(Permission.CONFIG_MANAGE)
  renew(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    return this.subs.renew(principal, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.CONFIG_MANAGE)
  cancel(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    return this.subs.cancel(principal, id);
  }
}

@Controller('billing')
export class BillingController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get('summary')
  @RequirePermissions(Permission.CONFIG_MANAGE)
  summary() {
    return this.subs.summary();
  }
}
