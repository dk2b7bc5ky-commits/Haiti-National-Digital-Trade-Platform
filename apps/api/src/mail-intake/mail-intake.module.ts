import { Module } from '@nestjs/common';
import { MailIntakeController } from './mail-intake.controller';
import { MailIntakeService } from './mail-intake.service';
import { DocumentsModule } from '../documents/documents.module';
import { DataHubModule } from '../data-hub/data-hub.module';
import { DeadlinesModule } from '../deadlines/deadlines.module';

/**
 * Email intake — the Alize agent (docs/ALIZE_AGENT_SCOPE.md A2/A3).
 *
 * Reuses DocumentsService (the shared extraction → charges → verification
 * pipeline) and ContainersService.quickAdd (the same container-creation path a
 * human uses), so mail-sourced data is identical to hand-entered data. The
 * mailbox itself is behind the MAILBOX_PROVIDER token in IntegrationModule.
 */
@Module({
  imports: [DocumentsModule, DataHubModule, DeadlinesModule],
  controllers: [MailIntakeController],
  providers: [MailIntakeService],
  exports: [MailIntakeService],
})
export class MailIntakeModule {}
