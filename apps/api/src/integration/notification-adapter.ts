/**
 * NotificationAdapter — the seam to email/SMS providers (spec §1.6).
 *
 * NO REAL PROVIDER IN THE BETA. A MockNotificationAdapter records "sends" so
 * deadline alerts can be demonstrated end-to-end. A real adapter (SendGrid,
 * Twilio, …) later implements this interface and is swapped in via the token
 * below without touching the deadline engine. In-app alerts do not go through
 * an adapter — they are served from the DeadlineAlert record itself.
 */
export const NOTIFICATION_ADAPTER = Symbol('NOTIFICATION_ADAPTER');

export interface NotificationMessage {
  channel: 'EMAIL' | 'SMS';
  /** Opaque recipient handle (email/phone). Resolved by the caller. */
  to: string;
  subject: string;
  body: string;
}

export interface NotificationResult {
  ok: boolean;
  ref: string | null;
  error?: string;
}

export interface NotificationAdapter {
  send(message: NotificationMessage): Promise<NotificationResult>;
}
