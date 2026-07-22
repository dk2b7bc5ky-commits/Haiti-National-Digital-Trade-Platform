import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { DeadlineService } from './deadline.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { normalizeLimit } from '../common/pagination';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly deadlines: DeadlineService) {}

  /** In-app alert feed for the caller's org (spec §1.5 in-app channel). */
  @Get()
  @RequirePermissions(Permission.CONTAINER_READ)
  list(
    @CurrentUser() principal: AuthPrincipal,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.deadlines.listAlerts(principal, status, normalizeLimit(limit));
  }

  @Post(':id/read')
  @HttpCode(200)
  @RequirePermissions(Permission.CONTAINER_READ)
  markRead(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    return this.deadlines.markRead(principal, id);
  }

  /** Manually run the dispatcher (also runs automatically every minute). */
  @Post('dispatch')
  @HttpCode(200)
  @RequirePermissions(Permission.CONFIG_MANAGE)
  dispatch() {
    return this.deadlines.dispatchDue();
  }
}
