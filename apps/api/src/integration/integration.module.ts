import { Global, Module } from '@nestjs/common';
import { TERMINAL_ADAPTER } from './terminal-adapter';
import { MockTerminalAdapter } from './mock-terminal.adapter';
import { NOTIFICATION_ADAPTER } from './notification-adapter';
import { MockNotificationAdapter } from './mock-notification.adapter';
import { EXTRACTION_PROVIDER } from './extraction-provider';
import { MockExtractionProvider } from './mock-extraction.provider';
import { ClaudeExtractionProvider } from './claude-extraction.provider';
import { MarketConfigService } from '../config/market-config.service';
import { PAYMENT_RAIL } from './payment-rail';
import { MockPaymentRail } from './mock-payment-rail.adapter';
import { ASYCUDA_ADAPTER } from './asycuda-adapter';
import { MockAsycudaAdapter } from './mock-asycuda.adapter';
import { MAILBOX_PROVIDER } from './mailbox-provider';
import { ImapMailboxProvider } from './imap-mailbox.provider';
import { MockMailboxProvider } from './mock-mailbox.provider';

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
    // Real Claude reader when ANTHROPIC_API_KEY is set (the Alize agent's brain);
    // otherwise the deterministic mock, so the app still runs without a key.
    {
      provide: EXTRACTION_PROVIDER,
      inject: [MarketConfigService],
      useFactory: (config: MarketConfigService) =>
        process.env.ANTHROPIC_API_KEY
          ? new ClaudeExtractionProvider()
          : new MockExtractionProvider(config),
    },
    // Real IMAP reader once a mailbox app password is present in the host's
    // secret store; otherwise a deterministic mock inbox, so the intake screen
    // and pipeline are demoable without credentials.
    {
      provide: MAILBOX_PROVIDER,
      useFactory: () =>
        process.env[process.env.MAIL_INTAKE_SECRET_VAR ?? 'MAIL_INTAKE_PASSWORD']
          ? new ImapMailboxProvider()
          : new MockMailboxProvider(),
    },
    { provide: PAYMENT_RAIL, useClass: MockPaymentRail },
    { provide: ASYCUDA_ADAPTER, useClass: MockAsycudaAdapter },
  ],
  exports: [TERMINAL_ADAPTER, NOTIFICATION_ADAPTER, EXTRACTION_PROVIDER, MAILBOX_PROVIDER, PAYMENT_RAIL, ASYCUDA_ADAPTER],
})
export class IntegrationModule {}
