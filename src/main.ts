import 'reflect-metadata';
import { config, envSource, safeMongoUri } from './config';
import * as fs from 'fs';
import * as path from 'path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter, ResponseInterceptor } from './common/http';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // POC: videos/PDFs on local disk, served at /uploads/... (express static supports Range for video seeking)
  const uploadRoot = path.resolve(config.uploadDir);
  for (const sub of ['videos', 'pdfs']) fs.mkdirSync(path.join(uploadRoot, sub), { recursive: true });
  app.useStaticAssets(uploadRoot, { prefix: '/uploads', maxAge: '7d' });

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('HungerStation LMS – POC API')
      .setDescription(
        'Rider login (Saudi phone + static OTP), Arabic/English, modules (video/PDF/quiz), offline sync without duplicates, ' +
          'auto-block by deadline cron, admin unblock, dashboard. All responses: { success, message, data }. ' +
          'Messages follow the user\'s saved language (or Accept-Language before login).',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, doc, { swaggerOptions: { persistAuthorization: true } });

  await app.listen(config.port, '0.0.0.0');
  const log = new Logger('Bootstrap');
  log.log(`Env      : ${envSource}`);
  log.log(`MongoDB  : ${safeMongoUri()}`);
  log.log(`API     : http://localhost:${config.port}/api`);
  log.log(`Swagger  : http://localhost:${config.port}/api/docs  (JSON for Postman: /api/docs-json)`);
  log.log(`Files    : ${config.baseUrl}/uploads/...`);
}
bootstrap();
