/**
 * ImapMailboxProvider — reads a Gmail / Google Workspace (or any IMAP) mailbox.
 *
 * Auth is an **app password** (Google account → Security → 2-Step Verification →
 * App passwords), supplied through the host's secret store. That's the fewest
 * steps for a non-technical operator and needs no OAuth consent screen; an
 * OAuth2 XOAUTH2 provider can implement this same interface later without the
 * pipeline changing.
 *
 * STRICTLY READ-ONLY: the mailbox is opened with `readOnly: true`, so the agent
 * cannot flag, move, or delete a message in the live human inbox. "Already
 * seen" is tracked by UID watermark in our own database instead.
 */
import { Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import {
  FetchOptions,
  MailAttachment,
  MailMessage,
  MailboxCredentials,
  MailboxProvider,
} from './mailbox-provider';

/** Attachment types worth handing to the reader (notices come as these). */
const USEFUL_ATTACHMENT = /\.(pdf|png|jpe?g|webp|gif|tiff?|xlsx?|csv)$/i;
/** Skip inline signature logos and other tiny decorative images. */
const MIN_ATTACHMENT_BYTES = 4 * 1024;
/** Never pull a single attachment larger than this into memory. */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export class ImapMailboxProvider implements MailboxProvider {
  readonly requiresCredential = true;
  private readonly logger = new Logger(ImapMailboxProvider.name);

  async verify(creds: MailboxCredentials): Promise<{ ok: boolean; error?: string; mailboxCount?: number }> {
    let client: ImapFlow | null = null;
    try {
      client = this.client(creds);
      await client.connect();
      const lock = await client.getMailboxLock(creds.folder, { readOnly: true });
      try {
        const count = typeof client.mailbox === 'object' ? client.mailbox.exists : undefined;
        return { ok: true, mailboxCount: count };
      } finally {
        lock.release();
      }
    } catch (e) {
      return { ok: false, error: describeImapError(e) };
    } finally {
      await this.close(client);
    }
  }

  async fetchSince(creds: MailboxCredentials, opts: FetchOptions): Promise<MailMessage[]> {
    const out: MailMessage[] = [];
    let client: ImapFlow | null = null;
    try {
      client = this.client(creds);
      await client.connect();
      const lock = await client.getMailboxLock(creds.folder, { readOnly: true });
      try {
        // On a first-ever sync, bound the backlog by date so connecting an inbox
        // with years of history doesn't ingest all of it.
        let range: string;
        if (opts.sinceUid && opts.sinceUid > 0) {
          range = `${opts.sinceUid + 1}:*`;
        } else {
          const days = opts.maxAgeDays ?? 30;
          const since = new Date(Date.now() - days * 86_400_000);
          const uids = await client.search({ since }, { uid: true });
          if (!uids || uids.length === 0) return [];
          range = uids.slice(-opts.limit).join(',');
        }

        // Collect UIDs first, then fetch newest-first up to the cap, so a large
        // backlog makes progress every run instead of timing out.
        const candidates: number[] = [];
        for await (const msg of client.fetch(range, { uid: true }, { uid: true })) {
          if (opts.sinceUid && msg.uid <= opts.sinceUid) continue;
          candidates.push(msg.uid);
        }
        if (candidates.length === 0) return [];
        candidates.sort((a, b) => a - b);
        const selected = candidates.slice(0, opts.limit);

        for (const uid of selected) {
          const raw = await client.download(String(uid), undefined, { uid: true });
          if (!raw?.content) continue;
          const buf = await streamToBuffer(raw.content);
          const parsed = await simpleParser(buf);

          const attachments: MailAttachment[] = [];
          for (const a of parsed.attachments ?? []) {
            const name = a.filename ?? '';
            const size = a.content?.length ?? 0;
            if (!name || !USEFUL_ATTACHMENT.test(name)) continue;
            if (size < MIN_ATTACHMENT_BYTES || size > MAX_ATTACHMENT_BYTES) continue;
            attachments.push({
              fileName: name,
              contentType: a.contentType || 'application/octet-stream',
              bytes: a.content as Buffer,
            });
          }

          const from = parsed.from?.value?.[0];
          out.push({
            messageId: parsed.messageId ?? `uid-${uid}@${creds.username}`,
            uid,
            fromAddress: (from?.address ?? '').toLowerCase(),
            fromName: from?.name ?? '',
            subject: parsed.subject ?? '(no subject)',
            receivedAt: parsed.date ?? new Date(),
            bodyText: bodyTextOf(parsed.text, parsed.html),
            attachments,
          });
        }
      } finally {
        lock.release();
      }
    } catch (e) {
      // Surfaced to the caller, which records it on the connection for the UI.
      throw new Error(describeImapError(e));
    } finally {
      await this.close(client);
    }
    return out;
  }

  private client(creds: MailboxCredentials): ImapFlow {
    return new ImapFlow({
      host: creds.host,
      port: creds.port,
      secure: creds.useTls,
      auth: { user: creds.username, pass: creds.password },
      logger: false,
      // Fail fast rather than hanging a cron tick on an unreachable host.
      socketTimeout: 60_000,
      greetingTimeout: 20_000,
      connectionTimeout: 20_000,
    });
  }

  private async close(client: ImapFlow | null): Promise<void> {
    if (!client) return;
    try {
      await client.logout();
    } catch {
      try {
        client.close();
      } catch {
        /* already gone */
      }
    }
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string));
  return Buffer.concat(chunks);
}

/** Prefer the text part; fall back to a rough de-tagging of the HTML part. */
function bodyTextOf(text: string | undefined, html: string | false | undefined): string {
  if (text && text.trim().length > 0) return text;
  if (typeof html === 'string' && html.length > 0) {
    return html
      // Keep table structure readable — MSC sends the notice as an HTML table.
      .replace(/<\/(td|th)>/gi, '\t')
      .replace(/<\/(tr|div|p|h[1-6]|li)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return '';
}

/**
 * Turns IMAP failures into something an operator can act on. Google's auth
 * failure for a non-app-password is the single most likely setup mistake.
 */
function describeImapError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed/i.test(msg)) {
    return 'Login rejected by the mail server. For Gmail / Google Workspace you must use a 16-character App Password (not the normal account password), and IMAP must be enabled.';
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return `Mail server hostname could not be resolved (${msg}).`;
  if (/ETIMEDOUT|timeout/i.test(msg)) return `Timed out connecting to the mail server (${msg}).`;
  if (/certificate|self.signed/i.test(msg)) return `TLS certificate problem talking to the mail server (${msg}).`;
  if (/\[NONEXISTENT\]|Mailbox doesn't exist/i.test(msg)) return `That mail folder does not exist (${msg}).`;
  return msg;
}
