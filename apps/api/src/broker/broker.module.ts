import { Module } from '@nestjs/common';
import { BrokerController } from './broker.controller';
import { BrokerService } from './broker.service';

/** Broker portal — manage the importers a broker clears for (spec §2.3). */
@Module({
  controllers: [BrokerController],
  providers: [BrokerService],
})
export class BrokerModule {}
