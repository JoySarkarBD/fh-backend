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
 * 2. Sets `/api` as the global route prefix.
 * 3. Applies security headers via Helmet.
 * 4. Enables HTTP request logging via Morgan (`dev` format).
 * 5. Registers a global {@link ValidationPipe} (whitelist + transform).
 * 6. Registers the global {@link ResponseInterceptor} and {@link HttpExceptionFilter}.
 * 7. Listens on the port defined by `config.PORT` (fallback: 3000).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors({
    origin: '*', // Allow all origins (adjust for production)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type, Accept, Authorization',
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

  const port = Number(config.PORT ?? 5000);
  await app.listen(port, () => {
    console.log(`🚀 API Gateway is running at http://localhost:${port}/api`);
  });
}

void bootstrap();
