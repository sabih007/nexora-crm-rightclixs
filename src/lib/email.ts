import 'server-only';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env, isProduction } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Outbound email.
 *
 * Two drivers:
 *   • `smtp` — real delivery through nodemailer.
 *   • `log`  — writes the message to `./.mail` and logs it (development).
 *
 * The result always reports whether delivery actually happened. Callers use
 * that to describe what occurred: the app never tells a user an invoice was
 * emailed when it only wrote a file to disk.
 */

const MAIL_DIR = path.resolve(process.cwd(), '.mail');

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

export interface EmailResult {
  delivered: boolean;
  driver: 'smtp' | 'log';
  note: string;
  messageId?: string;
}

type TransportLike = {
  sendMail(options: Record<string, unknown>): Promise<{ messageId?: string }>;
};

let transport: TransportLike | null = null;

async function getTransport(): Promise<TransportLike> {
  if (transport) return transport;
  const nodemailer = await import('nodemailer');
  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
      : {}),
  }) as unknown as TransportLike;
  return transport;
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  if (env.EMAIL_DRIVER === 'smtp') {
    try {
      const mailer = await getTransport();
      const info = await mailer.sendMail({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.attachments ? { attachments: message.attachments } : {}),
      });
      logger.info('Email dispatched', { to: message.to, subject: message.subject });
      return {
        delivered: true,
        driver: 'smtp',
        note: 'Accepted by the SMTP server.',
        ...(info.messageId ? { messageId: info.messageId } : {}),
      };
    } catch (error) {
      logger.error('Email delivery failed', { to: message.to, error });
      return {
        delivered: false,
        driver: 'smtp',
        note: 'The SMTP server rejected the message. See the server log.',
      };
    }
  }

  // Development driver: persist the message so it can be inspected, and be
  // explicit that nothing was actually sent.
  try {
    await mkdir(MAIL_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTo = message.to.replace(/[^a-z0-9@._-]/gi, '_');
    const file = path.join(MAIL_DIR, `${stamp}_${safeTo}.txt`);
    await writeFile(
      file,
      [
        `To: ${message.to}`,
        `From: ${env.EMAIL_FROM}`,
        `Subject: ${message.subject}`,
        `Attachments: ${message.attachments?.map((a) => a.filename).join(', ') ?? 'none'}`,
        '',
        message.text,
      ].join('\n'),
      'utf8',
    );
    logger.info('Email written to disk (log driver)', { to: message.to, file });
  } catch (error) {
    logger.error('Could not write the development email', { error });
  }

  if (isProduction) {
    logger.warn('EMAIL_DRIVER=log in production — no email is being delivered.');
  }

  return {
    delivered: false,
    driver: 'log',
    note: 'No email provider is configured, so the message was recorded locally instead of sent.',
  };
}

/** Surfaced on the Settings page so the configured state is never ambiguous. */
export function emailStatus(): { driver: string; description: string; productionReady: boolean } {
  if (env.EMAIL_DRIVER === 'smtp') {
    return {
      driver: 'smtp',
      description: `SMTP via ${env.SMTP_HOST}:${env.SMTP_PORT}. Messages are delivered for real.`,
      productionReady: true,
    };
  }
  return {
    driver: 'log',
    description:
      'No email provider configured. Messages are written to ./.mail and logged; nothing is delivered.',
    productionReady: false,
  };
}
