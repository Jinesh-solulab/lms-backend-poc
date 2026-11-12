import { Body, Controller, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import * as bcrypt from 'bcryptjs';
import { Model } from 'mongoose';
import { config } from './config';
import { Auth, CurrentUser } from './common/auth';
import { AppException, ok } from './common/http';
import { resolveLang } from './common/messages';
import { canonicalCity } from './common/meta';
import { normalizeSaudiPhone, publicUser } from './common/util';
import { RulesService } from './rules.service';
import { AdminLoginDto, SendOtpDto, UpdateLanguageDto, UpdateProfileDto, VerifyOtpDto } from './dto';
import { DbModel, M } from './schemas';

@ApiTags('Auth')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ar | en (used before login)' })
@Controller('auth')
export class AuthController {
  constructor(
    private jwt: JwtService,
    private rules: RulesService,
    @InjectModel(M.User) private users: DbModel,
  ) {}

  @Post('send-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rider: request OTP (POC: static OTP, no SMS sent)' })
  async sendOtp(@Body() dto: SendOtpDto) {
    const phone = normalizeSaudiPhone(dto.phone);
    if (!phone) throw new AppException('invalid_phone', 400);
    return ok('otp_sent', { phone, otpLength: config.staticOtp.length, expiresInSec: 300 });
  }

  @Post('verify-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rider: verify OTP and get JWT. New numbers are registered as riders.' })
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: any) {
    const phone = normalizeSaudiPhone(dto.phone);
    if (!phone) throw new AppException('invalid_phone', 400);
    if (String(dto.otp).trim() !== config.staticOtp) throw new AppException('invalid_otp', 401);

    const city = canonicalCity(dto.city);
    let user = await this.users.findOne({ phone }).lean();
    if (user && user.role !== 'rider') throw new AppException('account_not_rider', 403);
    let profileChanged = false;
    if (!user) {
      user = (await this.users.create({ phone, role: 'rider', language: resolveLang(req), city })).toObject();
      profileChanged = true;
    } else if (city && !user.city) {
      // City can be given at registration; an existing city is only changed by an admin.
      user = await this.users.findByIdAndUpdate(user._id, { $set: { city } }, { new: true }).lean();
      profileChanged = true;
    }
    if (!user.isActive) throw new AppException('account_inactive', 403);
    if (profileChanged) await this.rules.applyForRider(user._id); // auto-assign by saved rules

    await this.users.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    req.user = user; // so the response message uses the rider's saved language
    const token = await this.jwt.signAsync({ sub: String(user._id), role: user.role });
    return ok('login_success', { token, user: publicUser(user, user.language) });
  }

  @Post('admin/login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Admin: email + password login' })
  async adminLogin(@Body() dto: AdminLoginDto, @Req() req: any) {
    const user = await this.users.findOne({ email: dto.email.toLowerCase(), role: 'admin' }).select('+password').lean();
    if (!user || !user.password || !(await bcrypt.compare(dto.password, user.password))) {
      throw new AppException('invalid_credentials', 401);
    }
    delete user.password;
    req.user = user;
    const token = await this.jwt.signAsync({ sub: String(user._id), role: user.role });
    return ok('login_success', { token, user: publicUser(user, user.language) });
  }
}

@ApiTags('Me (rider & admin)')
@Auth()
@Controller('users/me')
export class MeController {
  constructor(
    private rules: RulesService,
    @InjectModel(M.User) private users: DbModel,
  ) {}

  @Get()
  @ApiOperation({ summary: 'My profile, including block status + localized reason' })
  me(@CurrentUser() user: any) {
    return ok('profile', publicUser(user, user.language));
  }

  @Patch('language')
  @ApiOperation({ summary: 'Save language preference (ar | en). All API messages follow it.' })
  async language(@Body() dto: UpdateLanguageDto, @CurrentUser() user: any) {
    await this.users.updateOne({ _id: user._id }, { $set: { language: dto.language } });
    user.language = dto.language; // req.user is the same object -> reply comes back in the new language
    return ok('language_updated', publicUser(user, dto.language));
  }

  @Patch()
  @ApiOperation({ summary: 'Update my name; a rider can also set their city once (while it is empty)' })
  async update(@Body() dto: UpdateProfileDto, @CurrentUser() user: any) {
    const $set: any = {};
    if (dto.name !== undefined) $set.name = dto.name;
    const city = canonicalCity(dto.city);
    let cityChanged = false;
    if (city && city !== user.city) {
      if (user.role === 'rider' && user.city) throw new AppException('city_already_set', 409);
      $set.city = city;
      cityChanged = true;
    }
    const updated = await this.users.findByIdAndUpdate(user._id, { $set }, { new: true }).lean();
    if (cityChanged) await this.rules.applyForRider(user._id);
    return ok('profile_updated', publicUser(updated, user.language));
  }
}
