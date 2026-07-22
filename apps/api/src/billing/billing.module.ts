import { Module } from '@nestjs/common';
import { ChargesController } from '../charges/charges.controller';
import { ChargesService } from '../charges/charges.service';
import { PayeesController } from '../payees/payees.controller';
import { PayeesService } from '../payees/payees.service';
import { MarketsController } from '../markets/markets.controller';
import { MarketsService } from '../markets/markets.service';

/**
 * Charges, payees, and market configuration (build step 4). Fees are read from
 * market config (MarketConfigService, global) and external terminal data comes
 * through the mock TerminalAdapter (IntegrationModule, global).
 */
@Module({
  controllers: [ChargesController, PayeesController, MarketsController],
  providers: [ChargesService, PayeesService, MarketsService],
  exports: [ChargesService, PayeesService],
})
export class BillingModule {}
