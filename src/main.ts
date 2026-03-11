/**
 * @fileoverview API Gateway bootstrap.
 *
 * Starts the HTTP server that acts as the single entry-point for all
 * client requests.  Registers global middleware (Helmet, Morgan),
 * validation pipes, the response interceptor, and the HTTP exception
 * filter before listening on the configured port.
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

/**
 * Bootstraps the NestJS API Gateway application.
 *
 * 1. Creates the Nest HTTP app from {@link AppModule}.
 * 2. Connects RabbitMQ Microservice for background tasks.
 * 3. Sets `/api` as the global route prefix.
 * 4. Applies security headers via Helmet.
 * 5. Enables HTTP request logging via Morgan (`dev` format).
 * 6. Registers a global {@link ValidationPipe} (whitelist + transform).
 * 7. Registers the global {@link ResponseInterceptor} and {@link HttpExceptionFilter}.
 * 8. Listens on the port defined by `config.PORT` (fallback: 3000).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Connect RabbitMQ microservice #1 — Mail queue
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [config.RABBITMQ_URL],
      queue: config.RABBITMQ_MAIL_QUEUE,
      noAck: false, // Essential for manual acknowledgement and reliability
      queueOptions: {
        durable: false,
      },
    },
  });

  // Connect RabbitMQ microservice #2 — Chat message queue
  // Uses a separate durable queue so chat messages survive broker restarts.
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [config.RABBITMQ_URL],
      queue: config.RABBITMQ_CHAT_QUEUE,
      noAck: false, // Manual ACK: consumer calls channel.ack() after buffering
      queueOptions: {
        durable: true, // Durable: survives RabbitMQ restarts
      },
    },
  });

  // Enable Socket.IO WebSocket adapter for the /chat namespace
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
      // Allow server-to-server and same-origin requests without Origin header
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

  // Set global route prefix to "api", but exclude webhook from prefix
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'webhook', method: RequestMethod.POST }],
  });

  // Apply security headers
  app.use(helmet());

  // Enable HTTP request logging
  app.use(morgan('dev'));

  // Register global validation pipe with strict options
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: true,
      exceptionFactory: (errors) => errors,
    }),
  );

  // Register global response interceptor and HTTP exception filter
  app.useGlobalInterceptors(new ResponseInterceptorInterceptor());

  // Register global HTTP exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Start microservices
  await app.startAllMicroservices();

  const port = Number(config.PORT ?? 5000);
  await app.listen(port, () => {
    console.log(`🚀 API Gateway is running at http://localhost:${port}/api`);
  });
}

void bootstrap();
