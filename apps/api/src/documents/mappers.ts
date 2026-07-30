import { Document, VerificationTask, DocumentSource, DocType, DocVerificationStatus, VerificationTaskStatus } from '@prisma/client';
import type {
  DocumentSummary,
  VerificationTaskSummary,
  DocumentSource as ApiDocSource,
  DocType as ApiDocType,
  DocVerificationStatus as ApiDocStatus,
  VerificationTaskStatus as ApiTaskStatus,
} from '@rezo/shared-types';

const lc = (s: string): string => s.toLowerCase();

export const docSourceToApi = (s: DocumentSource): ApiDocSource => lc(s) as ApiDocSource;
export const docTypeToApi = (t: DocType): ApiDocType => lc(t) as ApiDocType;
export const docStatusToApi = (s: DocVerificationStatus): ApiDocStatus => lc(s) as ApiDocStatus;
export const taskStatusToApi = (s: VerificationTaskStatus): ApiTaskStatus => lc(s) as ApiTaskStatus;

export function toDocumentSummary(d: Document): DocumentSummary {
  return {
    id: d.id,
    container_id: d.containerId,
    doc_type: docTypeToApi(d.docType),
    source: docSourceToApi(d.source),
    language: d.language,
    file_name: d.fileName,
    file_ref: d.fileRef,
    extraction_confidence: d.extractionConfidence,
    verification_status: docStatusToApi(d.verificationStatus),
    created_at: d.createdAt.toISOString(),
  };
}

type TaskRow = VerificationTask & { containerNumber?: string | null };

export function toTaskSummary(t: TaskRow): VerificationTaskSummary {
  return {
    id: t.id,
    document_id: t.documentId,
    charge_id: t.chargeId,
    container_id: t.containerId,
    container_number: t.containerNumber ?? null,
    field: t.field,
    confidence: t.confidence,
    status: taskStatusToApi(t.status),
    before_value: t.beforeValue,
    after_value: t.afterValue,
    created_at: t.createdAt.toISOString(),
    resolved_at: t.resolvedAt?.toISOString() ?? null,
  };
}
