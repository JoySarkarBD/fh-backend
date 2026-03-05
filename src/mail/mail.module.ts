import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Mail feature module.
 *
 * Registers the `Mail` schema and
 * exposes the `MailService` for the app.
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
