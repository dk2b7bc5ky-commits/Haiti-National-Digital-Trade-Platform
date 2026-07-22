import { Global, Module } from '@nestjs/common';
import { TERMINAL_ADAPTER } from './terminal-adapter';
import { MockTerminalAdapter } from './mock-terminal.adapter';
import { NOTIFICATION_ADAPTER } from './notification-adapter';
import { MockNotificationAdapter } from './mock-notification.adapter';
import { EXTRACTION_PROVIDER } from './extraction-provider';
import { MockExtractionProvider } from './mock-extraction.provider';
import { PAYMENT_RAIL } from './payment-rail';
import { MockPaymentRail } from './mock-payment-rail.adapter';

/**
 * Integration layer (spec §5). Every external system is bound to a DI token so
 * a real adapter can replace the mock without touching business logic. In the
 * beta only mocks are wired.
 */
@Global()
@Module({
  providers: [
    // Swap these for real adapters here when the external APIs exist.
    { provide: TERMINAL_ADAPTER, useClass: MockTerminalAdapter },
    { provide: NOTIFICATION_ADAPTER, useClass: MockNotificationAdapter },
    { provide: EXTRACTION_PROVIDER, useClass: MockExtractionProvider },
    { provide: PAYMENT_RAIL, useClass: MockPaymentRail },
  ],
  exports: [TERMINAL_ADAPTER, NOTIFICATION_ADAPTER, EXTRACTION_PROVIDER, PAYMENT_RAIL],
})
export class IntegrationModule {}
