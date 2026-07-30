import { Module } from '@nestjs/common';
import { DocumentsController, ContainerDocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { BillingModule } from '../billing/billing.module';
import { DeadlinesModule } from '../deadlines/deadlines.module';

/**
 * Document ingestion + verification queue (build step 7, spec §1.3/§1.7).
 * Uses StorageService (MinIO, global), the mock ExtractionProvider
 * (IntegrationModule, global), PayeesService (BillingModule) and DeadlineService
 * (DeadlinesModule).
 */
@Module({
  imports: [BillingModule, DeadlinesModule],
  controllers: [DocumentsController, ContainerDocumentsController, VerificationController],
  providers: [DocumentsService, VerificationService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
