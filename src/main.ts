/**
 * @fileoverview API Gateway bootstrap.
 */

import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { IoAdapter } from '@nestjs/platform-socket.io';
import 'dotenv/config';
import helmet from 'helmet';
import morgan from 'morgan';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filter/exception-response/exception-response.filter';
import { ResponseInterceptorInterceptor } from './common/interceptor/response-interceptor/response-interceptor.interceptor';
import { config } from './config/app.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  if (config.RABBITMQ_ENABLED) {
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

    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.RMQ,
      options: {
        urls: [config.RABBITMQ_URL],
        queue: config.RABBITMQ_CHAT_QUEUE,
        noAck: false,
        queueOptions: {
          durable: true,
        },
      },
    });
  } else {
    console.log('RabbitMQ disabled (RABBITMQ_ENABLED=false)');
  }

  app.useWebSocketAdapter(new IoAdapter(app));

  const allowedOrigins = [
    ...(config.FRONTEND_BASE_URL
      ? config.FRONTEND_BASE_URL.split(',').map((origin) => origin.trim())
      : []),
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ].filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type, Accept, Authorization, X-Requested-With',
  });

  app.setGlobalPrefix('api', {
    exclude: [{ path: 'webhook', method: RequestMethod.POST }],
  });

  app.use(helmet());
  app.use(morgan('dev'));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: true,
      exceptionFactory: (errors) => errors,
    }),
  );

  app.useGlobalInterceptors(new ResponseInterceptorInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  if (config.RABBITMQ_ENABLED) {
    await app.startAllMicroservices();
  }

  const port = Number(config.PORT ?? 5000);
  await app.listen(port, () => {
    console.log(`API Gateway is running at http://localhost:${port}/api`);
  });
}

void bootstrap();
