import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import * as nodemailer from 'nodemailer';
import { config } from 'src/config/app.config';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(@Inject('MAIL_SERVICE') private readonly client: ClientProxy) {
    this.transporter = nodemailer.createTransport({
      host: config.MAIL_HOST,
      port: Number(config.MAIL_PORT) || 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: config.MAIL_USER,
        pass: config.MAIL_PASS,
      },
    });
  }

  /**
   * Queues a single email for background processing.
   *
   * Intended for API paths that should return immediately while a worker
   * sends the actual SMTP email asynchronously.
   */
  async sendMail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }) {
    await this.enqueueMail(options);

    return {
      success: true,
      queued: true,
      to: options.to,
    };
  }

  /**
   * Sends an email immediately via SMTP.
   *
   * This should only be called by background consumers, not API handlers.
   */
  async sendMailDirect(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }) {
    try {
      this.logger.log(
        `Attempting to send email to: ${options.to} with subject: ${options.subject}`,
      );
      const info = await this.transporter.sendMail({
        from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_EMAIL}>`,
        ...options,
      });

      this.logger.log(
        `Email sent successfully to ${options.to}. Message ID: ${info.messageId}`,
      );
      return info;
    } catch (error) {
      const stack = error instanceof Error ? error.stack : String(error);
      this.logger.error(`Email sending failed for ${options.to}`, stack);
      throw error;
    }
  }

  /**
   * Send bulk mail by queueing individual email jobs.
   * This returns immediately while workers process SMTP delivery in the background.
   */
  async sendBulkMail(options: {
    to: string[];
    subject: string;
    html: string;
    text?: string;
  }) {
    const { to, ...rest } = options;

    for (const email of to) {
      void this.enqueueMail({ to: email, ...rest }).catch((error: unknown) => {
        const stack = error instanceof Error ? error.stack : String(error);
        this.logger.error(`Failed to enqueue bulk email for ${email}`, stack);
      });
    }

    this.logger.log(
      `Bulk mail requested: ${to.length} emails queued for processing.`,
    );
    return { success: true, queuedCount: to.length };
  }

  /**
   * Pushes an email task to the RabbitMQ queue.
   */
  async enqueueMail(data: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    retryCount?: number;
  }) {
    try {
      // Ensure the publish Observable is actually executed.
      await new Promise<void>((resolve, reject) => {
        this.client.emit('send_mail', data).subscribe({
          next: () => resolve(),
          complete: () => resolve(),
          error: (error: unknown) => reject(error),
        });
      });
    } catch (error) {
      const stack = error instanceof Error ? error.stack : String(error);
      this.logger.error('Failed to enqueue email', stack);
      throw error;
    }
  }
}
