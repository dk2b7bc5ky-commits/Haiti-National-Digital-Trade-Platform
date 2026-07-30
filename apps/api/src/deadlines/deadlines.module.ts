import { Module } from '@nestjs/common';
import { DeadlineService } from './deadline.service';
import { AlertsController } from './alerts.controller';

/**
 * Deadline & alert engine (build step 6, spec §1.5). Exports DeadlineService so
 * the charges layer can trigger a recompute and the container detail can list
 * deadlines. Alerts are dispatched on a cron tick (see @Cron in the service).
 */
@Module({
  controllers: [AlertsController],
  providers: [DeadlineService],
  exports: [DeadlineService],
})
export class DeadlinesModule {}
