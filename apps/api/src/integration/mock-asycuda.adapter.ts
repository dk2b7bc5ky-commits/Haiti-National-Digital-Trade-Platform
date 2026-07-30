import { Injectable } from '@nestjs/common';
import { AsycudaAdapter, AsycudaClearance } from './asycuda-adapter';

/**
 * Mock customs system. Returns a cleared declaration with a deterministic
 * reference derived from the container number (no randomness).
 */
@Injectable()
export class MockAsycudaAdapter implements AsycudaAdapter {
  async getClearance(input: { containerNumber: string }): Promise<AsycudaClearance> {
    return {
      cleared: true,
      declarationRef: `ASY-${input.containerNumber}`,
      status: 'cleared',
    };
  }
}
