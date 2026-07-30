/**
 * AsycudaAdapter — the seam to ASYCUDA World (customs) for declaration status
 * and clearance (spec §1.6). NO REAL ASYCUDA IN THE BETA — a mock returns a
 * cleared declaration so the release flow works end-to-end. A real adapter later
 * implements this interface and is swapped in via the token below.
 */
export const ASYCUDA_ADAPTER = Symbol('ASYCUDA_ADAPTER');

export interface AsycudaClearance {
  cleared: boolean;
  /** Customs declaration reference (opaque). */
  declarationRef: string | null;
  status: string; // e.g. "cleared", "held", "inspection_required"
}

export interface AsycudaAdapter {
  getClearance(input: { containerNumber: string }): Promise<AsycudaClearance>;
}
