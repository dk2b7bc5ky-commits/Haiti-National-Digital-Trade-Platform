import { Module } from '@nestjs/common';
import { PaymentsController, FxController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { FxService } from './fx.service';
import { BillingModule } from '../billing/billing.module';

/**
 * Payment Orchestrator (build step 8, spec §2.1). Aggregates a container's
 * charges into one authorize-once request and routes each portion directly to
 * its payee via the mock PaymentRail (IntegrationModule, global). Rezo holds no
 * funds. Uses PayeesService (BillingModule) for settlement routing tokens.
 */
@Module({
  imports: [BillingModule],
  controllers: [PaymentsController, FxController],
  providers: [PaymentsService, FxService],
  exports: [PaymentsService, FxService],
})
export class PaymentsModule {}
