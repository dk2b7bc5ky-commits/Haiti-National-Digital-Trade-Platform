import { Module } from '@nestjs/common';
import { TransportService } from './transport.service';
import { TransportJobsController, GateAppointmentsController } from './transport.controller';

/** Trucker portal + gate appointments (build step 11, spec §2.4). */
@Module({
  controllers: [TransportJobsController, GateAppointmentsController],
  providers: [TransportService],
})
export class TransportModule {}
