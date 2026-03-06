import { Module } from '@nestjs/common';
import { MailService } from 'src/mail/mail.service';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  controllers: [ContactController],
  providers: [ContactService, MailService],
})
export class ContactModule {}
