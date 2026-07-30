import { Global, Module } from '@nestjs/common';
import { MarketConfigService } from './market-config.service';

/** Global so any module can read market/tariff config without re-importing. */
@Global()
@Module({
  providers: [MarketConfigService],
  exports: [MarketConfigService],
})
export class MarketConfigModule {}
