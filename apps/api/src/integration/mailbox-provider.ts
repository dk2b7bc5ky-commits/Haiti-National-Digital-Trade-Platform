/**
 * MailboxProvider — the seam to a real inbox (docs/ALIZE_AGENT_SCOPE.md A2).
 *
 * Read-only by contract: implementations may fetch and (optionally) advance a
 * read watermark, but MUST NOT delete, move, or send mail. The Alize agent
 * watches a live human inbox, so anything beyond reading is out of bounds.
 *
 * Everything a provider returns is UNTRUSTED INPUT — it is authored by whoever
 * emailed the mailbox. It is only ever treated as data to extract fields from;
 * no instruction inside an email may steer what the agent does.
 */
export const MAILBOX_PROVIDER = Symbol('MAILBOX_PROVIDER');

export interface MailAttachment {
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

export interface MailMessage {
  /** RFC-5322 Message-ID; the dedupe key. Synthesized if the server omits it. */
  messageId: string;
  /** IMAP UID, used as the "already seen" watermark. */
  uid: number;
  fromAddress: string;
  fromName: string;
  subject: string;
  receivedAt: Date;
  /** Plain-text body (HTML is down-converted when that's all there is). */
  bodyText: string;
  attachments: MailAttachment[];
}

export interface MailboxCredentials {
  host: string;
  port: number;
  useTls: boolean;
  username: string;
  /** Resolved at call time from the host's secret store — never persisted. */
  password: string;
  folder: string;
}

export interface FetchOptions {
  /** Only return messages with a UID greater than this. */
  sinceUid?: number | null;
  /** Hard cap on messages returned in one run (keeps a backlog from stalling). */
  limit: number;
  /** Ignore anything older than this many days on a first-ever sync. */
  maxAgeDays?: number;
  /**
   * Fetch exactly these UIDs and nothing else, ignoring `sinceUid`/`maxAgeDays`.
   * Used by the backfill, which decides for itself which of the mailbox's older
   * messages it still needs (see MailIntakeService.backfill).
   */
  uids?: number[];
}

export interface MailboxProvider {
  /**
   * Whether this provider needs a password before it can be used. True for a
   * real mailbox; false for the mock, so the intake pipeline stays demoable
   * without any credential configured.
   *
   * Also drives the UI's "you are on the demo inbox" disclosure — never let a
   * mock success be mistaken for a real connection.
   */
  readonly requiresCredential: boolean;
  /** Confirms the credentials work, without ingesting anything. */
  verify(creds: MailboxCredentials): Promise<{ ok: boolean; error?: string; mailboxCount?: number }>;
  fetchSince(creds: MailboxCredentials, opts: FetchOptions): Promise<MailMessage[]>;
  /**
   * Every UID in the folder newer than `days` ago, ascending. Cheap (a UID
   * search, no bodies downloaded) so the backfill can work out what remains
   * before pulling anything.
   */
  listUidsSince(creds: MailboxCredentials, days: number): Promise<number[]>;
}
