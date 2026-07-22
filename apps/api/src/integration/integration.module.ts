import { Global, Module } from '@nestjs/common';
import { TERMINAL_ADAPTER } from './terminal-adapter';
import { MockTerminalAdapter } from './mock-terminal.adapter';

/**
 * Integration layer (spec §5). Every external system is bound to a DI token so
 * a real adapter can replace the mock without touching business logic. In the
 * beta only mocks are wired.
 */
@Global()
@Module({
  providers: [
    // Swap MockTerminalAdapter for a real one here when a terminal API exists.
    { provide: TERMINAL_ADAPTER, useClass: MockTerminalAdapter },
  ],
  exports: [TERMINAL_ADAPTER],
})
export class IntegrationModule {}
