import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { MailService } from './mail.service';

@Controller()
export class MailConsumer {
  private readonly logger = new Logger(MailConsumer.name);
  private readonly MAX_RETRIES = 5;

  constructor(private readonly mailService: MailService) {}

  @EventPattern('send_mail')
  async handleSendMail(@Payload() data: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    const { to, subject, html, text, retryCount = 0 } = data;

    try {
      this.logger.log(
        `Processing email to: ${to} (Attempt: ${retryCount + 1})`,
      );
      await this.mailService.sendMailDirect({ to, subject, html, text });

      // Acknowledge the message if successful
      channel.ack(originalMsg);
      this.logger.log(`Email to ${to} sent successfully`);
    } catch (error) {
      if (retryCount < this.MAX_RETRIES) {
        this.logger.warn(
          `Failed to send email to ${to}. Retrying... (${retryCount + 1}/${this.MAX_RETRIES})`,
        );

        // Re-queue with incremented retry count
        // In a real production environment, you might want to use a delay/backoff here.
        // For simplicity, we are just re-emitting the event with updated data.
        // Note: We don't acknowledge the original message yet, or we could Nack it.
        // Actually, to implement manual retry with count, it's better to Nack with requeue=false
        // and manually push a new message if we want to control the payload.

        const nextRetryData = { ...data, retryCount: retryCount + 1 };

        // We ack the current message so it's removed from queue,
        // then we'll re-publish it via the service if we had access to the client,
        // or just let RMQ handle it if we use Nack with requeue: true (but that doesn't allow changing data).

        // Better professional approach: use a delayed exchange or just nack if it's transient.
        // For the "try 5 times" requirement, I'll manually handle the requeue by re-publishing
        // through the MailService (I'll add a method there).

        await this.mailService.enqueueMail(nextRetryData);
        channel.ack(originalMsg);
      } else {
        this.logger.error(
          `Failed to send email to ${to} after ${this.MAX_RETRIES} attempts. Logging and dropping.`,
        );
        // Here you would typically log to a database or DLQ
        channel.ack(originalMsg); // Ack to remove from queue after final failure
      }
    }
  }
}
