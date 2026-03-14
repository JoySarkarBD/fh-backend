import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './src/app.module';
import { config } from './src/config/app.config';
import { MailService } from './src/mail/mail.service';

async function bootstrap() {
  console.log('Bootstrapping NestJS application and mail queue consumer...');

  const app = await NestFactory.create(AppModule);

  // Attach the mail RMQ consumer so queued jobs are processed in this test run.
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [config.RABBITMQ_URL],
      queue: config.RABBITMQ_MAIL_QUEUE,
      noAck: false,
      queueOptions: {
        durable: false,
      },
    },
  });

  await app.startAllMicroservices();
  await app.init();

  console.log(`Mail consumer attached to queue: ${config.RABBITMQ_MAIL_QUEUE}`);

  try {
    const mailService = app.get(MailService);

    const emails = [
      'developer.joysarkar@gmail.com',
      'joysarkarbd407@gmail.com',
      'developer.joysarkar.db@gmail.com',
      // 'ishrat.rintu.fb@gmail.com',
      // 'info.faysal.32@gmail.com',
      // 'faiz4121820@gmail.com',
      // 'fay553632@gmail.com',
      // 'cloudmining5001@gmail.com',
    ];

    console.log(`\n--- Mail Queue Publish Test ---`);
    console.log(`Target Emails: ${emails.length} addresses.`);

    const subject = 'Manual Bulk Test Email';
    const html = `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
        <h2 style="color: #2e7d32;">Bulk Test Notification</h2>
        <p>This is a queue test email published by the manual testing script.</p>
        <p><strong>Published at:</strong> ${new Date().toLocaleString()}</p>
        <hr>
        <p style="font-size: 0.8em; color: #666;">This is part of the Farrior Homes Backend queue testing process.</p>
      </div>
    `;
    const text =
      'This is a queue test email published by the manual testing script.';

    const queueResults = await Promise.allSettled(
      emails.map(async (email) => {
        await mailService.enqueueMail({
          to: email,
          subject,
          html,
          text,
        });
        return email;
      }),
    );

    const queued = queueResults.filter(
      (result) => result.status === 'fulfilled',
    ).length;
    const failedResults = queueResults.filter(
      (result) => result.status === 'rejected',
    );

    console.log('\nQueue Publish Summary:');
    console.log(
      JSON.stringify(
        { total: emails.length, queued, failed: failedResults.length },
        null,
        2,
      ),
    );

    if (failedResults.length > 0) {
      console.error('\nFailed queue publishes:');
      failedResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(`  ${index + 1}.`, result.reason);
        }
      });
    }

    console.log('\n--- Queue Test Completed ---');

    // Keep process alive long enough for the background consumer to send emails.
    const waitMs = Number(process.env.MAIL_TEST_WAIT_MS || 15000);
    console.log(
      `Waiting ${waitMs}ms for background consumer to process jobs...`,
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  } catch (error) {
    console.error('\n--- Test Failed ---');
    console.error(error);
  } finally {
    await app.close();
    process.exit(0);
  }
}

bootstrap();
