import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/index.js';

/** Enough for a healthy relay, short enough that a sick one cannot hold a request. */
const CONNECTION_TIMEOUT_MS = 5_000;
const GREETING_TIMEOUT_MS = 5_000;
const SOCKET_TIMEOUT_MS = 10_000;

/**
 * Sends reuse a small pool of connections instead of opening one each.
 *
 * Without this, every message is its own SMTP connection. That was invisible
 * while sends were awaited one request at a time, and it broke the moment
 * PD-32 detached them: fifteen concurrent resets opened fifteen connections
 * and ten died with "Greeting never received" — the relay was queueing them
 * past the greeting timeout. Ten mails lost, and nothing in the response said
 * so, because a detached send reports only to the log.
 *
 * Three is deliberately small. Real relays cap concurrent connections far
 * harder than a local sink does, so the pool is what keeps a burst from
 * looking like abuse.
 */
const MAX_CONNECTIONS = 3;

/** Connections are recycled rather than held forever. */
const MAX_MESSAGES_PER_CONNECTION = 100;

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Owns the single nodemailer transporter.
 *
 * `send` throws on failure. Whether a failure should fail the request is the
 * caller's decision, not this service's — see the delivery policy in
 * auth.factory.ts, where the answer is no because the user row is written
 * before the mail is sent.
 *
 * Deliberately no `transporter.verify()` at startup, which is where this
 * differs from RedisService. Redis is on the path of every request — the cache,
 * and the rate limiter since PD-36 — so a bad URL there should stop the boot.
 * Mail is on the path of two flows that already treat delivery failure as
 * non-fatal; refusing to boot for a briefly unreachable relay would contradict
 * that policy and turn a degraded feature into a total outage.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);

  private readonly transporter: Transporter;

  private readonly from: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.from = config.mail.from;
    // `url` inside the options object rather than as the first argument: the
    // string overload's second parameter is message defaults, not transport
    // options, so the timeouts would be silently rejected there. This form
    // takes both.
    this.transporter = createTransport({
      url: config.mail.smtpUrl,
      pool: true,
      maxConnections: MAX_CONNECTIONS,
      maxMessages: MAX_MESSAGES_PER_CONNECTION,
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: GREETING_TIMEOUT_MS,
      socketTimeout: SOCKET_TIMEOUT_MS,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });

    // The recipient's address is deliberately absent. An application log is not
    // a place to accumulate user email addresses, and the relay's own log has
    // the delivery record if one is ever needed.
    this.logger.log(`Sent: ${message.subject}`);
  }

  onModuleDestroy(): void {
    // Releases pooled connections on SIGTERM, alongside the Prisma and Redis
    // shutdowns.
    this.transporter.close();
  }
}
