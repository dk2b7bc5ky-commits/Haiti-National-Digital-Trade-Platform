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

export interface ExtractionResult {
  docType: string; // e.g. "terminal_invoice"
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
