import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  ExtractionProvider,
  ExtractionInput,
  ExtractionResult,
  ExtractedCharge,
} from './extraction-provider';

/**
 * Real OCR/LLM extractor backed by Claude — the "reading brain" of the Alize
 * email agent (docs/ALIZE_AGENT_SCOPE.md). It implements the SAME
 * ExtractionProvider interface as the mock, so the DocumentsService and the
 * whole ingestion pipeline (charges → verification queue → deadlines) are
 * unchanged; only the source of the structured fields differs.
 *
 * Enabled automatically when ANTHROPIC_API_KEY is present (see
 * integration.module.ts); otherwise the mock stays wired so nothing breaks.
 *
 * It reads Haitian shipping arrival notices — Maersk/AGEMAR, MSC, King
 * Ocean/DEMSA, … — in French, English, or Kreyòl, as PDF, image, or text, and
 * returns each payable charge mapped to the platform's charge types. Anything
 * it is unsure about gets a low confidence score, which the pipeline routes to
 * the Ops verification queue rather than a live bill.
 */

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5';

// Charge types the platform understands (must match Prisma ChargeType, lower-cased).
const CHARGE_TYPES = [
  'customs_duty',
  'customs_fee',
  'port_dues',
  'terminal_handling',
  'storage',
  'demurrage',
  'detention',
  'inspection',
  'scanning',
] as const;

const SYSTEM_PROMPT = `You extract structured data from Haitian import "arrival notices" (avis d'arrivage) issued by shipping lines and their local agents (e.g. Maersk / AGEMAR, MSC, King Ocean / DEMSA, CMA CGM, Seaboard). Notices arrive in French, English, or Haitian Kreyòl, as PDFs, images, spreadsheets, or email text.

Extract only the charges the importer must actually PAY now — the itemized amounts under "TOTAL TO PAY", "COLLECT CHARGES", "à l'ordre de", or a per-line charges table. Do NOT turn a future demurrage/detention TARIFF SCHEDULE (a table of daily rates that would apply only after free time expires) into charges — those are not amounts due today.

Map each payable line to the single closest charge type from this list:
- port_dues        — port authority / APN / "autorité portuaire" / port dues
- customs_duty     — customs tax or duty / AGD / "droits de douane" / customs tax bill
- customs_fee      — customs processing/handling/documentation fee
- terminal_handling— terminal local charge (TLC/LTC), gate move, "mise en position", destination fees, freight-collect, agency fee, RCV, doc fee, security fee, or any line handled by the terminal/agent that does not clearly fit another type
- storage          — storage / "entreposage" / reefer electricity ("frais d'électricité")
- demurrage        — demurrage / "surestaries"
- detention        — container detention
- inspection       — physical inspection
- scanning         — scanning fee

Confidence rules (0.0–1.0): use a HIGH score (>0.85) only when the amount and its meaning are unambiguous. If a line doesn't clearly fit any type, still pick the closest type but give it a LOW score (<0.6) so a human reviews it. Never invent charges.

Also extract: the container number and B/L number if present (a notice may list several containers — use the first, or leave null if a single number isn't clear), the arrival date / ETA, and the last free day / free-time expiry (as an ISO 8601 date if you can determine it; otherwise null). Amounts are decimal in the notice's currency (e.g. 260.00, USD or HTG).`;

const TOOL = {
  name: 'record_arrival_notice',
  description: 'Record the structured contents of a shipping arrival notice.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      doc_type: { type: 'string', description: 'e.g. arrival_notice, terminal_invoice' },
      language: { type: 'string', description: 'ISO code: fr, en, or ht' },
      container_number: { type: ['string', 'null'] },
      bl_number: { type: ['string', 'null'] },
      arrival_date: { type: ['string', 'null'], description: 'ISO 8601 date or null' },
      last_free_day: { type: ['string', 'null'], description: 'ISO 8601 date or null' },
      charges: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: CHARGE_TYPES as unknown as string[] },
            label: { type: 'string', description: 'The original wording from the notice' },
            amount: { type: 'number', description: 'Decimal amount in major units, e.g. 260.00' },
            currency: { type: 'string', description: 'ISO 4217, e.g. USD or HTG' },
            confidence: { type: 'number' },
          },
          required: ['type', 'amount', 'currency', 'confidence'],
        },
      },
      overall_confidence: { type: 'number' },
    },
    required: ['charges'],
  },
};

interface ClaudeCharge {
  type: string;
  label?: string;
  amount: number;
  currency: string;
  confidence: number;
}
interface ClaudeExtraction {
  doc_type?: string;
  language?: string;
  container_number?: string | null;
  bl_number?: string | null;
  arrival_date?: string | null;
  last_free_day?: string | null;
  charges: ClaudeCharge[];
  overall_confidence?: number;
}

const IMAGE_MEDIA: Record<string, 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
};

@Injectable()
export class ClaudeExtractionProvider implements ExtractionProvider {
  private readonly logger = new Logger('ClaudeExtractionProvider');
  private readonly client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const content = this.buildContent(input);

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      // Structured extraction: no thinking needed, force the recording tool so
      // the model must return the schema. (Disabled thinking is valid at the
      // default 'high' effort.)
      thinking: { type: 'disabled' },
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'record_arrival_notice' },
      messages: [{ role: 'user', content }],
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('Claude did not return structured arrival-notice data.');
    }
    const parsed = toolUse.input as ClaudeExtraction;

    const lastFreeDayIso = this.toIso(parsed.last_free_day);
    const charges: ExtractedCharge[] = (parsed.charges ?? [])
      .filter((c) => CHARGE_TYPES.includes(c.type as (typeof CHARGE_TYPES)[number]) && c.amount > 0)
      .map((c) => ({
        type: c.type,
        amount: Math.round(c.amount * 100), // decimal major units → integer minor units
        currency: (c.currency || 'USD').toUpperCase().slice(0, 3),
        confidence: clamp01(c.confidence),
        lastFreeDayIso,
      }));

    this.logger.log(
      `Extracted ${charges.length} charge(s) from ${input.fileName} via ${MODEL} ` +
        `(container=${parsed.container_number ?? '—'}, bl=${parsed.bl_number ?? '—'})`,
    );

    return {
      docType: parsed.doc_type ?? 'arrival_notice',
      language: parsed.language ?? 'fr',
      rawText: JSON.stringify(parsed, null, 2),
      containerNumber: parsed.container_number ?? input.containerNumberHint ?? null,
      blNumber: parsed.bl_number ?? null,
      charges,
      overallConfidence:
        parsed.overall_confidence != null
          ? clamp01(parsed.overall_confidence)
          : charges.length
            ? Math.min(...charges.map((c) => c.confidence))
            : 0,
    };
  }

  /** Turns the uploaded bytes into a Claude content array (PDF / image / text). */
  private buildContent(input: ExtractionInput): Anthropic.ContentBlockParam[] {
    const instruction = { type: 'text' as const, text: 'Extract the payable charges and shipment details from this arrival notice.' };
    const ct = (input.contentType || '').toLowerCase();
    const b64 = input.bytes.toString('base64');

    if (ct.includes('pdf')) {
      return [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
        instruction,
      ];
    }
    const media = IMAGE_MEDIA[ct];
    if (media) {
      return [
        { type: 'image', source: { type: 'base64', media_type: media, data: b64 } },
        instruction,
      ];
    }
    // Fallback: treat as text (email body, .txt, CSV, or best-effort for other types).
    const text = input.bytes.toString('utf-8').slice(0, 100_000);
    return [{ type: 'text', text: `${instruction.text}\n\n---\n${text}` }];
  }

  private toIso(v: string | null | undefined): string | null {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
}

function clamp01(n: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
