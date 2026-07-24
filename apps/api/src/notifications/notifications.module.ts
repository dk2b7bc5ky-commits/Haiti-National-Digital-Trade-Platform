import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

/**
 * Global so any service (payments, tracking, gate, verification, charges,
 * transport, deadlines) can inject NotificationsService and fire events (spec
 * §6b) without import churn. NOTIFICATION_ADAPTER comes from the global
 * IntegrationModule.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
