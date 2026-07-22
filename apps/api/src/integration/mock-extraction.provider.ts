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
      language: 'fr',
      rawText,
      containerNumber: input.containerNumberHint ?? null,
      blNumber: null,
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
