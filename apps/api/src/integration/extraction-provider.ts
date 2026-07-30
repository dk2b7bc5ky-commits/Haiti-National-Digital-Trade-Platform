/**
 * ExtractionProvider — the seam to OCR + LLM field extraction (spec §1.3/§1.6).
 *
 * NO REAL OCR/LLM VENDOR IN THE BETA. The MockExtractionProvider returns
 * realistic structured fields with plausible per-field confidence scores so the
 * verification flow works end-to-end. A real provider later implements this
 * interface and is swapped in via the token below — the DocumentsService never
 * changes. Money is integer minor units + currency (spec §15).
 */
export const EXTRACTION_PROVIDER = Symbol('EXTRACTION_PROVIDER');

export interface ExtractedCharge {
  /** API charge type string, e.g. "terminal_handling". */
  type: string;
  amount: number; // minor units
  currency: string;
  confidence: number; // 0.0–1.0
  lastFreeDayIso?: string | null;
}

/**
 * What kind of document this is. Drives whether it becomes money or just
 * information — the single most important distinction the reader makes.
 */
export type DocumentKind =
  | 'arrival_notice'
  | 'invoice'
  | 'booking_confirmation'
  | 'release_order'
  | 'customs_document'
  | 'schedule_change'
  | 'statement'
  | 'correspondence'
  | 'not_relevant';

export interface ExtractionResult {
  docType: string; // e.g. "terminal_invoice"
  /** Classified kind; `not_relevant` means don't file this at all. */
  kind: DocumentKind;
  /**
   * TRUE only when the document is actually asking for money NOW (an invoice, a
   * notice itemizing collect charges, a statement with a balance due).
   *
   * A booking confirmation, quote, rate sheet, or demurrage tariff schedule
   * contains amounts but demands nothing — those must be FALSE, otherwise the
   * importer sees phantom "you owe" lines for shipments they haven't been billed
   * for. Charges are only ever written when this is true.
   */
  demandsPayment: boolean;
  /** Plain-language summary of what the document says, in its own language. */
  summary: string;
  /** What the human has to do about it, or null when nothing is needed. */
  actionRequired: string | null;
  /** A date the human is working to (deadline, cut-off, ETA), if stated. */
  dueDateIso?: string | null;
  language: string; // ISO code
  rawText: string;
  /** Keys used to match the document to a container when none is supplied. */
  containerNumber?: string | null;
  blNumber?: string | null;
  charges: ExtractedCharge[];
  overallConfidence: number;
}

export interface ExtractionInput {
  fileName: string;
  contentType: string;
  bytes: Buffer;
  docTypeHint?: string;
  containerNumberHint?: string | null;
}

export interface ExtractionProvider {
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}
