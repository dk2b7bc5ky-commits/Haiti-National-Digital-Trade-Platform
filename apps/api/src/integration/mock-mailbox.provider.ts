/**
 * MockMailboxProvider — a deterministic stand-in for a real inbox, wired
 * whenever no mailbox password is configured. It returns two messages that
 * mirror shapes seen in real Alize mail (one arrival notice, one unrelated
 * message the classifier must ignore), so the intake pipeline and the review
 * screen are exercisable end-to-end with no credentials.
 */
import { FetchOptions, MailMessage, MailboxCredentials, MailboxProvider } from './mailbox-provider';

const NOTICE_BODY = `AVIS D'ARRIVEE / ARRIVAL NOTICE

Consignee: ALIZE IMPORTS SA
Navire / Vessel: MV DEMO CARRIER   Voyage: 026W
Connaissement / B/L No: DEMOBL0001234
Conteneur / Container: DEMU1234567   Taille / Size: 40HC
Date d'arrivee / Arrival date: 2026-07-24
Dernier jour franc / Last free day: 2026-07-29
Jours francs demurrage: 5   Jours francs electricite: 3

CHARGES / FRAIS
  Frais de manutention terminal (THC) .......... USD 250.00
  APN - droits de port ......................... USD  50.00
  Frais d'agence ............................... USD  75.00

Reglement a: AGENCE MARITIME DEMO S.A.
`;

export class MockMailboxProvider implements MailboxProvider {
  /** No credential needed — this is the demo inbox. */
  readonly requiresCredential = false;

  async verify(): Promise<{ ok: boolean; error?: string; mailboxCount?: number }> {
    return { ok: true, mailboxCount: 2 };
  }

  async listUidsSince(): Promise<number[]> {
    return this.messages().map((m) => m.uid);
  }

  async fetchSince(creds: MailboxCredentials, opts: FetchOptions): Promise<MailMessage[]> {
    const all = this.messages();
    // Backfill asks for specific UIDs; a normal run walks forward from the mark.
    if (opts.uids && opts.uids.length > 0) {
      const want = new Set(opts.uids);
      return all.filter((m) => want.has(m.uid)).slice(0, opts.limit);
    }
    const since = opts.sinceUid ?? 0;
    return all.filter((m) => m.uid > since).slice(0, opts.limit);
  }

  private messages(): MailMessage[] {
    return [
      {
        messageId: '<demo-arrival-notice-1@example.invalid>',
        uid: 1,
        fromAddress: 'operations@agemar.example',
        fromName: 'Agence Maritime Demo',
        subject: "Avis d'arrivée / Arrival Notice — B/L DEMOBL0001234 — DEMU1234567",
        receivedAt: new Date('2026-07-24T13:05:00.000Z'),
        bodyText: NOTICE_BODY,
        attachments: [],
      },
      {
        messageId: '<demo-unrelated-2@example.invalid>',
        uid: 2,
        fromAddress: 'newsletter@example.invalid',
        fromName: 'Industry Weekly',
        subject: 'Your weekly logistics newsletter',
        receivedAt: new Date('2026-07-24T14:00:00.000Z'),
        bodyText: 'This week in logistics: rates, congestion, and an upcoming webinar.',
        attachments: [],
      },
      // A second notice, so "catch up on older mail" has something to find
      // after the first two have already been read.
      {
        messageId: '<demo-arrival-notice-3@example.invalid>',
        uid: 3,
        fromAddress: 'ops@mschaiti.example',
        fromName: 'MSC Haiti',
        subject: 'Arrival Notice — MEDU7654321 — B/L DEMOBL0009999',
        receivedAt: new Date('2026-07-22T09:15:00.000Z'),
        bodyText: NOTICE_BODY.replace('DEMU1234567', 'MEDU7654321')
          .replace('DEMOBL0001234', 'DEMOBL0009999')
          .replace('40HC', '20GP'),
        attachments: [],
      },
    ];
  }
}
