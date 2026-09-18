import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/index.js';

const CONNECTION_TIMEOUT_MS = 5_000;
const GREETING_TIMEOUT_MS = 5_000;
const SOCKET_TIMEOUT_MS = 10_000;

const MAX_CONNECTIONS = 3;

const MAX_MESSAGES_PER_CONNECTION = 100;

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);

  private readonly transporter: Transporter;

  private readonly from: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.from = config.mail.from;

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

    this.logger.log(`Sent: ${message.subject}`);
  }

  onModuleDestroy(): void {
    this.transporter.close();
  }
}
