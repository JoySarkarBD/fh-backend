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

  async sendMail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }) {
    try {
      this.logger.log(`Attempting to send email to: ${options.to} with subject: ${options.subject}`);
      const info = await this.transporter.sendMail({
        from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_EMAIL}>`,
        ...options,
      });

      this.logger.log(`Email sent successfully to ${options.to}. Message ID: ${info.messageId}`);
      return info;
    } catch (error) {
      this.logger.error(`Email sending failed for ${options.to}`, error.stack);
      throw error;
    }
  }

  /**
   * Send bulk mail by queueing individual email jobs.
   * This offloads the work to the RabbitMQ workers.
   */
  async sendBulkMail(options: {
    to: string[];
    subject: string;
    html: string;
    text?: string;
  }) {
    const { to, ...rest } = options;

    // Wait for all emails to be queued before returning
    await Promise.all(
      to.map((email) => this.enqueueMail({ to: email, ...rest })),
    );

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
      this.client.emit('send_mail', data);
    } catch (error) {
      this.logger.error('Failed to enqueue email', error);
      throw error;
    }
  }
}
