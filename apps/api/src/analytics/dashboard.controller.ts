import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboards: DashboardService) {}

  @Get('operational')
  @RequirePermissions(Permission.DASHBOARD_VIEW)
  operational(@CurrentUser() principal: AuthPrincipal) {
    return this.dashboards.operational(principal);
  }

  @Get('government')
  @RequirePermissions(Permission.DASHBOARD_GOV)
  government() {
    return this.dashboards.government();
  }
}
