import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { config } from 'src/config/app.config';
import { MailConsumer } from './mail.consumer';

/**
 * Mail feature module.
 *
 * Registers the `Mail` schema and
 * exposes the `MailService` for the app.
 */
@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'MAIL_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [config.RABBITMQ_URL],
          queue: config.RABBITMQ_MAIL_QUEUE,
          queueOptions: {
            durable: false,
          },
        },
      },
    ]),
  ],
  controllers: [MailConsumer],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
