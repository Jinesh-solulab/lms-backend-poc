import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs/operators';
import { resolveLang, t } from './messages';

/** Throw with a message key; the filter translates it into the caller's language. */
export class AppException extends HttpException {
  constructor(key: string, status = 400, params?: Record<string, any>, data?: any) {
    super({ key, params, data }, status);
  }
}

/** Controllers return ok('message_key', data) and the interceptor localizes the message. */
export function ok(key: string, data?: any, params?: Record<string, any>) {
  return { __i18n: key, data, params };
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    return next.handle().pipe(
      map((body) => {
        const lang = resolveLang(req);
        if (body && body.__i18n) {
          return { success: true, message: t(body.__i18n, lang, body.params), data: body.data ?? null };
        }
        return { success: true, message: t('ok', lang), data: body ?? null };
      }),
    );
  }
}

const STATUS_KEYS: Record<number, string> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  413: 'file_too_large',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private logger = new Logger('Error');

  catch(ex: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();
    const lang = resolveLang(req);

    if (ex instanceof AppException) {
      const r: any = ex.getResponse();
      return res.status(ex.getStatus()).json({
        success: false,
        code: r.key,
        message: t(r.key, lang, r.params),
        ...(r.data !== undefined ? { data: r.data } : {}),
      });
    }

    if (ex instanceof HttpException) {
      const status = ex.getStatus();
      const r: any = ex.getResponse();
      if (status === 400 && Array.isArray(r?.message)) {
        return res.status(400).json({
          success: false,
          code: 'validation_failed',
          message: t('validation_failed', lang),
          errors: r.message,
        });
      }
      const key = STATUS_KEYS[status];
      return res.status(status).json({
        success: false,
        code: key || 'http_error',
        message: key ? t(key, lang) : r?.message || ex.message,
      });
    }

    if (ex?.name === 'CastError' || ex?.name === 'BSONError') {
      return res.status(400).json({ success: false, code: 'invalid_id', message: t('invalid_id', lang) });
    }

    this.logger.error(ex?.stack || ex);
    return res.status(500).json({ success: false, code: 'server_error', message: t('server_error', lang) });
  }
}
