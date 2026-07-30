import { ContainerSize, ChargeType } from '@prisma/client';

/**
 * TerminalAdapter — the seam to a terminal operating system (Octopi / CPS).
 *
 * NO REAL TERMINAL API EXISTS IN THE BETA (spec CRITICAL CONTEXT / §1.6). The
 * beta ships a MockTerminalAdapter only. A real adapter later implements this
 * same interface and is swapped in via the DI token below — business logic
 * (ChargesService) never changes.
 *
 * Contract: given a container's identifying data, return the terminal's view —
 * which terminal holds it and what terminal-side charges apply. All money is
 * integer minor units + ISO-4217 currency (spec §15).
 */
export const TERMINAL_ADAPTER = Symbol('TERMINAL_ADAPTER');

export interface TerminalChargeLine {
  type: ChargeType;
  amount: number; // minor units
  currency: string; // ISO-4217
  /** Last free day before storage/demurrage accrues (spec §1.5). */
  lastFreeDay?: string | null;
  dueDate?: string | null;
}

export interface TerminalContainerInfo {
  /** The terminal org that holds the container (payee for terminal charges). */
  terminalOrgId: string;
  charges: TerminalChargeLine[];
}

export interface TerminalLookupInput {
  containerNumber: string;
  sizeType: ContainerSize;
  arrivalDate: Date | null;
  /** Terminal org to attribute charges to (the terminal whose system we query). */
  terminalOrgId: string;
}

export interface TerminalAdapter {
  /**
   * True when this is a stand-in rather than a real terminal system. A mock
   * fabricates plausible charges from the tariff, which must never reach a real
   * container — see ChargesService.syncTerminal.
   */
  readonly isMock: boolean;
  /** Fetch terminal-side charges for a container. */
  getContainerInfo(input: TerminalLookupInput): Promise<TerminalContainerInfo>;
}
