import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { MailService } from './src/mail/mail.service';

async function bootstrap() {
  console.log('Bootstrapping NestJS application context...');

  // Ensure we don't try to connect to MongoDB if it's not needed for this simple test,
  // though Nest will try to initialize all modules in AppModule.

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const mailService = app.get(MailService);

    const emails = [
      'developer.joysarkar@gmail.com',
      'joysarkarbd407@gmail.com',
      'developer.joysarkar.db@gmail.com',
      'ishrat.rintu.fb@gmail.com',
      'info.faysal.32@gmail.com',
      'faiz4121820@gmail.com',
      'fay553632@gmail.com',
      'cloudmining5001@gmail.com',
    ];

    console.log(`\n--- Bulk Mail Test ---`);
    console.log(`Target Emails: ${emails.length} addresses queued.`);

    const result = await mailService.sendBulkMail({
      to: emails,
      subject: 'Manual Bulk Test Email',
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
          <h2 style="color: #2e7d32;">Bulk Test Notification</h2>
          <p>This is a test bulk email sent via the manual testing script.</p>
          <p><strong>Sent at:</strong> ${new Date().toLocaleString()}</p>
          <hr>
          <p style="font-size: 0.8em; color: #666;">This is part of the Farrior Homes Backend testing process.</p>
        </div>
      `,
      text: 'This is a test bulk email sent via the manual testing script.',
    });

    console.log('\nResult:', JSON.stringify(result, null, 2));
    console.log('\n--- Test Completed Successfully ---');

    // Give RabbitMQ 1 second to finish network operations before we close the app
    console.log('Waiting for connections to settle...');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    console.error('\n--- Test Failed ---');
    console.error(error);
  } finally {
    await app.close();
    process.exit(0);
  }
}

bootstrap();
