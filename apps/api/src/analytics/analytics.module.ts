import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** Operational + government read-model dashboards (build step 13, spec §2.6). */
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class AnalyticsModule {}
