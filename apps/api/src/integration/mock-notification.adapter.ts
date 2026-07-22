import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationAdapter,
  NotificationMessage,
  NotificationResult,
} from './notification-adapter';

/**
 * Mock email/SMS provider. Logs the "send" and returns a synthetic reference so
 * the deadline engine can mark alerts delivered. Deterministic (no randomness).
 */
@Injectable()
export class MockNotificationAdapter implements NotificationAdapter {
  private readonly logger = new Logger('MockNotificationAdapter');
  private counter = 0;

  async send(message: NotificationMessage): Promise<NotificationResult> {
    this.counter += 1;
    const ref = `mock-${message.channel.toLowerCase()}-${this.counter}`;
    this.logger.log(`[${message.channel}] → ${message.to} :: ${message.subject}`);
    return { ok: true, ref };
  }
}
