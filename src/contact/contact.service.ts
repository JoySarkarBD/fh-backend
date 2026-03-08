import { Injectable, Logger } from '@nestjs/common';
import { CreateContactDto } from './dto/create-contact.dto';
import { MailService } from 'src/mail/mail.service';
import { config } from 'src/config/app.config';
import { InjectModel } from '@nestjs/mongoose';
import { Contact, ContactDocument } from 'src/schemas/contact.schema';
import { Model } from 'mongoose';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly mailService: MailService,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
  ) {}

  async create(createContactDto: CreateContactDto) {
    const { firstName, lastName, email, message } = createContactDto;

    await this.contactModel.create({
      firstName,
      lastName,
      email,
      message,
    });

    const subject = 'New Contact Message from Website';

    const html = `
      <div style="font-family: Arial, sans-serif; background-color: #f5f7f5; padding: 20px;">
        <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 8px; padding: 30px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
          <h2 style="color: #4a6c50;">New Contact Message</h2>
          <p><strong>Name:</strong> ${firstName} ${lastName}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Message:</strong></p>
          <p style="background-color:#eaf0e9; padding: 15px; border-radius: 5px;">${message}</p>
          <hr style="border:none; border-top:1px solid #d0d0d0; margin:20px 0;">
          <p style="font-size:12px; color:#888;">This message was sent from your website contact form.</p>
        </div>
      </div>
    `;

    // Send email to admin/support
    try {
      const info = await this.mailService.sendMail({
        to: config.CONTACT_RECEIVER_EMAIL, // set this in your config
        subject,
        html,
        text: message, // optional plain text
      });

      this.logger.log(`Contact email sent successfully: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      this.logger.error('Failed to send contact email', error);
      throw error;
    }
  }
}
