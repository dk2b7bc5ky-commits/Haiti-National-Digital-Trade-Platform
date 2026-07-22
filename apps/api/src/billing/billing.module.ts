import { Module } from '@nestjs/common';
import { ChargesController } from '../charges/charges.controller';
import { ChargesService } from '../charges/charges.service';
import { PayeesController } from '../payees/payees.controller';
import { PayeesService } from '../payees/payees.service';
import { MarketsController } from '../markets/markets.controller';
import { MarketsService } from '../markets/markets.service';
import { SubscriptionsService } from './subscriptions.service';
import {
  SubscriptionsController,
  SubscriptionPlansController,
  BillingController,
} from './subscriptions.controller';
import { DeadlinesModule } from '../deadlines/deadlines.module';

/**
 * Charges, payees, and market configuration (build step 4). Fees are read from
 * market config (MarketConfigService, global) and external terminal data comes
 * through the mock TerminalAdapter (IntegrationModule, global).
 */
@Module({
  imports: [DeadlinesModule],
  controllers: [
    ChargesController,
    PayeesController,
    MarketsController,
    SubscriptionsController,
    SubscriptionPlansController,
    BillingController,
  ],
  providers: [ChargesService, PayeesService, MarketsService, SubscriptionsService],
  exports: [ChargesService, PayeesService],
})
export class BillingModule {}
