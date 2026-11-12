import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Model } from 'mongoose';
import { DbModel, M } from '../schemas';
import { AppException } from './http';

export type Role = 'rider' | 'admin';
const ROLES_KEY = 'roles';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private reflector: Reflector,
    @InjectModel(M.User) private users: DbModel,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppException('unauthorized', 401);

    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new AppException('unauthorized', 401);
    }

    // Load fresh user each request so language / block status are always current.
    const user = await this.users.findById(payload.sub).lean();
    if (!user) throw new AppException('unauthorized', 401);
    req.user = user;
    if (!user.isActive) throw new AppException('account_inactive', 403);

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(user.role)) throw new AppException('forbidden', 403);
    return true;
  }
}

/** @Auth() = any logged-in user, @Auth('admin') = admins only, @Auth('rider') = riders only. */
export const Auth = (...roles: Role[]) =>
  applyDecorators(SetMetadata(ROLES_KEY, roles), UseGuards(JwtAuthGuard), ApiBearerAuth());

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user);
