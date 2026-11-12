import 'reflect-metadata';
import { config, envSource, safeMongoUri } from './config';
import * as fs from 'fs';
import * as path from 'path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { AllExceptionsFilter, ResponseInterceptor } from './common/http';
import { resolveLang, t } from './common/messages';

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

  // Health / "server is up": GET / and GET /api/health
  const conn = app.get<Connection>(getConnectionToken());
  const startedAt = new Date();
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const health = (req: any, res: any) => {
    const db = dbStates[conn.readyState] || 'unknown';
    res.status(200).json({
      success: true,
      message: t('server_running', resolveLang(req)),
      data: {
        service: 'HungerStation LMS – POC API',
        version: '0.1.0',
        status: 'up',
        database: db,
        startedAt,
        uptimeSeconds: Math.round(process.uptime()),
        time: new Date(),
        api: '/api',
        docs: '/api/docs',
      },
    });
  };
  app.getHttpAdapter().get('/', health);
  app.getHttpAdapter().get('/api/health', health);

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
  log.log(`Health   : http://localhost:${config.port}/  (also /api/health)`);
  log.log(`API      : http://localhost:${config.port}/api`);
  log.log(`Swagger  : http://localhost:${config.port}/api/docs  (JSON for Postman: /api/docs-json)`);
  log.log(`Files    : ${config.baseUrl}/uploads/...`);
}
bootstrap();
