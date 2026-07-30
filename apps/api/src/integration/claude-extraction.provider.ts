import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  DocumentKind,
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

const DOC_KINDS = [
  'arrival_notice',
  'invoice',
  'booking_confirmation',
  'release_order',
  'customs_document',
  'schedule_change',
  'statement',
  'correspondence',
  'not_relevant',
] as const;

const SYSTEM_PROMPT = `You read the operational mail of a Haitian import business: arrival notices, invoices, booking confirmations, customs paperwork, release orders, and correspondence from shipping lines and their local agents (Maersk/AGEMAR, MSC, CMA CGM/J.B. Vital, King Ocean/DEMSA, Seaboard, Evergreen/SAMAR, ZIM/NADAL, Hapag-Lloyd/ENMARCOLDA, …), from the port authority (APN), and from customs (AGD). Documents arrive in French, English, or Haitian Kreyòl, as PDFs, images, spreadsheets, or plain email text.

Your job has three parts.

## 1. Classify the document (\`kind\`)

- arrival_notice — tells the consignee a shipment has arrived or is arriving.
- invoice — a bill: "facture", "invoice", "montant à payer", "total to pay", a demand for a specific sum.
- booking_confirmation — a booking / e-booking / reservation confirmation, quote, or rate sheet. These routinely list freight rates, tariffs, and surcharges. They are CONFIRMATIONS OF ARRANGEMENTS, NOT BILLS.
- release_order — a release, "bon de sortie", delivery order, gate release, or customs clearance confirmation.
- customs_document — declaration, assessment, tax bill from AGD, or customs correspondence.
- schedule_change — vessel delay, ETA change, roll-over, blank sailing, cut-off change.
- statement — a statement of account or aged balance listing several invoices.
- correspondence — ordinary back-and-forth: questions, instructions, document requests, confirmations of receipt.
- not_relevant — nothing to do with importing goods (marketing, newsletters, personal mail, internal HR, automated account notices).

## 2. Decide whether it DEMANDS PAYMENT NOW (\`demands_payment\`)

This is the most important judgement you make. Set it TRUE **only** when the document is asking this importer to pay a specific sum now — an invoice, an arrival notice that itemizes charges collectable before release ("COLLECT CHARGES", "à l'ordre de", "TOTAL TO PAY"), or a statement with a balance due.

Set it FALSE — even though amounts appear in the document — for:
- booking confirmations, e-bookings, quotes, rate sheets, and freight tariffs;
- demurrage / detention / storage TARIFF SCHEDULES (tables of daily rates that would only apply after free time expires);
- amounts marked prepaid, already paid, or payable by the shipper;
- estimates, "for your information", or projected costs;
- anything where you are not confident a specific sum is being demanded of the importer right now.

When in doubt, FALSE. A missed bill is a phone call; a phantom bill makes the importer think they owe money they do not.

If demands_payment is FALSE, return an EMPTY \`charges\` array. Never list reference amounts as charges.

## 3. Summarize and say what to do

- \`summary\` — 1–3 sentences, plain language, in the SAME LANGUAGE as the document. What is this, about which shipment, and what does it say? Include the concrete specifics (vessel, dates, amounts, container numbers) rather than generic phrasing.
- \`action_required\` — what this importer must actually DO, in one short sentence, or null if nothing is needed. Examples: "Pay USD 385.00 to AGEMAR before 29 July to avoid storage." / "Send the signed original B/L to the agent." / "Nothing to do — the vessel is simply delayed to 2 August." Do not invent an action; informational mail usually has none.
- \`due_date\` — the date the importer is working toward (payment deadline, last free day, document cut-off, new ETA), ISO 8601, or null.

## Charges (only when demands_payment is TRUE)

Map each payable line to the single closest type:
- port_dues        — port authority / APN / "autorité portuaire" / port dues
- customs_duty     — customs tax or duty / AGD / "droits de douane"
- customs_fee      — customs processing / handling / documentation fee
- terminal_handling— terminal local charge (TLC/LTC), gate move, "mise en position", destination fees, freight collect, agency fee, RCV, doc fee, security fee, or any agent/terminal line that does not clearly fit another type
- storage          — storage / "entreposage" / reefer electricity ("frais d'électricité")
- demurrage        — demurrage / "surestaries"
- detention        — container detention
- inspection       — physical inspection
- scanning         — scanning fee

Confidence (0.0–1.0): above 0.85 only when both the amount and its meaning are unambiguous. If a line doesn't clearly fit a type, pick the closest and score it below 0.6 so a human reviews it. Never invent a charge.

Also extract the container number and B/L number when present (if a document lists several containers use the first; null if no single number is clear). Amounts are decimal in the document's currency (e.g. 260.00 USD).`;

const TOOL = {
  name: 'record_document',
  description: 'Record what this piece of import mail is, what it says, and any amounts it actually demands.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: DOC_KINDS as unknown as string[] },
      doc_type: { type: 'string', description: 'Free-text label, e.g. arrival_notice, terminal_invoice' },
      demands_payment: {
        type: 'boolean',
        description: 'TRUE only if a specific sum is being demanded of the importer now. Booking confirmations, quotes and tariff schedules are FALSE.',
      },
      summary: { type: 'string', description: '1–3 sentences in the document\'s own language.' },
      action_required: { type: ['string', 'null'], description: 'One short sentence, or null if nothing to do.' },
      due_date: { type: ['string', 'null'], description: 'ISO 8601 date the importer is working toward, or null' },
      language: { type: 'string', description: 'ISO code: fr, en, or ht' },
      container_number: { type: ['string', 'null'] },
      bl_number: { type: ['string', 'null'] },
      arrival_date: { type: ['string', 'null'], description: 'ISO 8601 date or null' },
      last_free_day: { type: ['string', 'null'], description: 'ISO 8601 date or null' },
      charges: {
        type: 'array',
        description: 'MUST be empty unless demands_payment is true.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: CHARGE_TYPES as unknown as string[] },
            label: { type: 'string', description: 'The original wording from the document' },
            amount: { type: 'number', description: 'Decimal amount in major units, e.g. 260.00' },
            currency: { type: 'string', description: 'ISO 4217, e.g. USD or HTG' },
            confidence: { type: 'number' },
          },
          required: ['type', 'amount', 'currency', 'confidence'],
        },
      },
      overall_confidence: { type: 'number' },
    },
    required: ['kind', 'demands_payment', 'summary', 'charges'],
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
  kind?: string;
  doc_type?: string;
  demands_payment?: boolean;
  summary?: string;
  action_required?: string | null;
  due_date?: string | null;
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
      tool_choice: { type: 'tool', name: 'record_document' },
      messages: [{ role: 'user', content }],
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('Claude did not return structured document data.');
    }
    const parsed = toolUse.input as ClaudeExtraction;

    const kind = normalizeKind(parsed.kind);
    // A document only becomes money when it is genuinely a demand for payment.
    // Enforced here as well as in the prompt: kinds that are never bills can
    // never produce charges, no matter what the model returned.
    const demandsPayment = parsed.demands_payment === true && CAN_DEMAND_PAYMENT.has(kind);

    const lastFreeDayIso = this.toIso(parsed.last_free_day);
    const charges: ExtractedCharge[] = demandsPayment
      ? (parsed.charges ?? [])
          .filter((c) => CHARGE_TYPES.includes(c.type as (typeof CHARGE_TYPES)[number]) && c.amount > 0)
          .map((c) => ({
            type: c.type,
            amount: Math.round(c.amount * 100), // decimal major units → integer minor units
            currency: (c.currency || 'USD').toUpperCase().slice(0, 3),
            confidence: clamp01(c.confidence),
            lastFreeDayIso,
          }))
      : [];

    if (!demandsPayment && (parsed.charges ?? []).length > 0) {
      this.logger.log(
        `${input.fileName}: ${parsed.charges.length} reference amount(s) kept OUT of billing — ` +
          `${kind} does not demand payment.`,
      );
    }
    this.logger.log(
      `Read ${input.fileName} via ${MODEL}: kind=${kind} demandsPayment=${demandsPayment} ` +
        `charges=${charges.length} (container=${parsed.container_number ?? '—'}, bl=${parsed.bl_number ?? '—'})`,
    );

    return {
      docType: parsed.doc_type ?? kind,
      kind,
      demandsPayment,
      summary: (parsed.summary ?? '').trim(),
      actionRequired: parsed.action_required?.trim() || null,
      dueDateIso: this.toIso(parsed.due_date) ?? lastFreeDayIso,
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
            : 0.8,
    };
  }

  /** Turns the uploaded bytes into a Claude content array (PDF / image / text). */
  private buildContent(input: ExtractionInput): Anthropic.ContentBlockParam[] {
    const instruction = {
      type: 'text' as const,
      text: 'Classify this piece of import mail, summarize it, say what the importer must do, and record any amounts it actually demands.',
    };
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

/** Kinds that can legitimately be a demand for payment. */
const CAN_DEMAND_PAYMENT = new Set<DocumentKind>(['invoice', 'arrival_notice', 'statement', 'customs_document']);

function normalizeKind(v: string | undefined): DocumentKind {
  return (DOC_KINDS as readonly string[]).includes(v ?? '') ? (v as DocumentKind) : 'correspondence';
}

function clamp01(n: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
