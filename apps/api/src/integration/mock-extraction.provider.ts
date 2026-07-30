import { Injectable } from '@nestjs/common';
import { MarketConfigService } from '../config/market-config.service';
import {
  ExtractionProvider,
  ExtractionInput,
  ExtractionResult,
  ExtractedCharge,
} from './extraction-provider';

/**
 * Mock OCR/LLM extractor. Deterministic (no randomness): given a document it
 * returns a plausible terminal invoice with several charge lines, amounts drawn
 * from market config, and per-field confidence scores. It always includes ONE
 * below-threshold line (a smudged "storage" figure) so the verification queue
 * and Ops-correction flow are demonstrable (spec §1.3, acceptance #2).
 */
@Injectable()
export class MockExtractionProvider implements ExtractionProvider {
  constructor(private readonly config: MarketConfigService) {}

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    // Booking confirmations quote rates but bill nothing. The mock recognizes
    // them too, so the "information only, no charges" path is demonstrable
    // without an API key.
    const text = `${input.fileName}\n${input.bytes.toString('utf-8').slice(0, 4000)}`.toLowerCase();
    if (/booking|e-?book|reservation|réservation|quote|devis|tarif/.test(text)) {
      return {
        docType: 'booking_confirmation',
        kind: 'booking_confirmation',
        demandsPayment: false,
        summary:
          'Booking confirmation for an upcoming shipment. It lists the agreed freight rate and surcharges for reference — it is not a bill.',
        actionRequired: null,
        dueDateIso: null,
        language: 'en',
        rawText: `BOOKING CONFIRMATION (mock)\nDocument: ${input.fileName}\nRates quoted for reference only.`,
        containerNumber: input.containerNumberHint ?? null,
        blNumber: null,
        goodsDescription: 'General merchandise (mock)',
        arrivalDateIso: null,
        charges: [], // deliberately none — a booking is not a demand for payment
        overallConfidence: 0.93,
      };
    }

    const handling = await this.config.terminalHandling('FORTY');
    const storage = await this.config.storagePerDay('FORTY');
    const currency = handling.currency;

    // A last-free-day a bit out, deterministic from the file name.
    const lfd = new Date('2026-08-15T00:00:00.000Z');
    lfd.setUTCDate(lfd.getUTCDate() + (this.hash(input.fileName) % 5));
    const lfdIso = lfd.toISOString();

    const charges: ExtractedCharge[] = [
      { type: 'terminal_handling', amount: handling.amount, currency, confidence: 0.97, lastFreeDayIso: lfdIso },
      { type: 'demurrage', amount: 12000, currency, confidence: 0.9, lastFreeDayIso: lfdIso },
      // Deliberately low-confidence — lands in the verification queue.
      { type: 'storage', amount: storage.amount * 4, currency, confidence: 0.62, lastFreeDayIso: lfdIso },
    ];

    const rawText = [
      'PORT-AU-PRINCE TERMINAL — INVOICE (mock OCR)',
      `Document: ${input.fileName}`,
      input.containerNumberHint ? `Container: ${input.containerNumberHint}` : 'Container: (see header)',
      ...charges.map((c) => `${c.type}: ${(c.amount / 100).toFixed(2)} ${c.currency} [conf ${c.confidence}]`),
    ].join('\n');

    return {
      docType: 'terminal_invoice',
      kind: 'arrival_notice',
      demandsPayment: true,
      summary:
        'Arrival notice with terminal handling, demurrage and storage charges collectable before the container can be released.',
      actionRequired: 'Confirm the amounts, then settle them before the last free day.',
      dueDateIso: lfdIso,
      language: 'fr',
      rawText,
      containerNumber: input.containerNumberHint ?? null,
      blNumber: null,
      goodsDescription: 'Assorted dry goods (mock)',
      // Recent, so the mock exercises the "current business" path.
      arrivalDateIso: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      charges,
      overallConfidence: Math.min(...charges.map((c) => c.confidence)),
    };
  }

  private hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
}
