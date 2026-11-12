import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsMongoId,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const LANG_VALUES = ['ar', 'en', 'ur'];
type LangValue = 'ar' | 'en' | 'ur';

/* ---------------- Auth / users ---------------- */

export class SendOtpDto {
  @ApiProperty({ example: '0500000001', description: 'Saudi mobile: 05XXXXXXXX / +9665XXXXXXXX' })
  @IsString()
  phone: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: '0500000001' })
  @IsString()
  phone: string;

  @ApiProperty({ example: '126', description: 'Static OTP for the POC (STATIC_OTP in .env)' })
  @IsString()
  otp: string;
}

export class AdminLoginDto {
  @ApiProperty({ example: 'admin@hungerstation.local' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Admin@123' })
  @IsString()
  password: string;
}

export class UpdateLanguageDto {
  @ApiProperty({ enum: LANG_VALUES, example: 'ur' })
  @IsIn(LANG_VALUES)
  language: LangValue;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ahmed Ali' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

/* ---------------- Admin: riders ---------------- */

export class CreateRiderDto {
  @ApiProperty({ example: '0500000099' })
  @IsString()
  phone: string;

  @ApiPropertyOptional({ example: 'Ahmed Ali' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Riyadh' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ enum: LANG_VALUES, example: 'ar' })
  @IsOptional()
  @IsIn(LANG_VALUES)
  language?: LangValue;
}

export class UpdateRiderDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ example: 'Jeddah' }) @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional({ enum: LANG_VALUES }) @IsOptional() @IsIn(LANG_VALUES) language?: LangValue;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class BlockRiderDto {
  @ApiProperty({ example: 'Safety violation reported by supervisor' })
  @IsString()
  @Length(2, 500)
  reason: string;
}

export class UnblockRiderDto {
  @ApiPropertyOptional({ example: 'Rider will complete training today' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    example: '2026-11-15T18:00:00.000Z',
    description:
      'Optional new deadline for the rider\'s overdue modules. If given, the cron will block again only if this new date is missed.',
  })
  @IsOptional()
  @IsDateString()
  newDueAt?: string;
}

/* ---------------- Admin: modules & quiz ---------------- */

export class LocalizedTextDto {
  @ApiProperty({ example: 'أساسيات سلامة الغذاء' })
  @IsString()
  @MaxLength(2000)
  ar: string;

  @ApiProperty({ example: 'Food Safety Basics' })
  @IsString()
  @MaxLength(2000)
  en: string;

  @ApiPropertyOptional({ example: 'فوڈ سیفٹی کی بنیادی باتیں', description: 'Urdu (optional; riders see English when empty)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  ur?: string;
}

export class CreateModuleDto {
  @ApiProperty({ type: LocalizedTextDto })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  title: LocalizedTextDto;

  @ApiPropertyOptional({ type: LocalizedTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  description?: LocalizedTextDto;

  @ApiPropertyOptional({ example: 7, description: 'Default deadline in days after assignment' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  deadlineDays?: number;

  @ApiPropertyOptional({ example: 90, description: 'Video counts as completed at this watch %' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  videoCompletePercent?: number;
}

export class UpdateModuleDto {
  @ApiPropertyOptional({ type: LocalizedTextDto }) @IsOptional() @ValidateNested() @Type(() => LocalizedTextDto) title?: LocalizedTextDto;
  @ApiPropertyOptional({ type: LocalizedTextDto }) @IsOptional() @ValidateNested() @Type(() => LocalizedTextDto) description?: LocalizedTextDto;
  @ApiPropertyOptional({ example: 7 }) @IsOptional() @IsInt() @Min(1) @Max(365) deadlineDays?: number;
  @ApiPropertyOptional({ example: 90 }) @IsOptional() @IsInt() @Min(1) @Max(100) videoCompletePercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class QuizQuestionDto {
  @ApiPropertyOptional({ description: 'Existing question id (keep it when editing so offline answers still match)' })
  @IsOptional()
  @IsMongoId()
  id?: string;

  @ApiProperty({ type: LocalizedTextDto })
  @ValidateNested()
  @Type(() => LocalizedTextDto)
  text: LocalizedTextDto;

  @ApiProperty({ type: [LocalizedTextDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => LocalizedTextDto)
  options: LocalizedTextDto[];

  @ApiProperty({ example: 0, description: 'Index of the correct option (0-based)' })
  @IsInt()
  @Min(0)
  correctIndex: number;
}

export class SaveQuizDto {
  @ApiProperty({ example: 3, description: 'Correct answers needed to pass, e.g. 3 of 5' })
  @IsInt()
  @Min(1)
  passMark: number;

  @ApiProperty({ type: [QuizQuestionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuizQuestionDto)
  questions: QuizQuestionDto[];
}

export class AssignModuleDto {
  @ApiPropertyOptional({ type: [String], description: 'Specific rider ids. Leave empty to use filters.' })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  userIds?: string[];

  @ApiPropertyOptional({ example: 'Jeddah', description: 'Assign to all riders in this city' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: '2026-11-20T18:00:00.000Z', description: 'Exact due date (overrides deadlineDays)' })
  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @ApiPropertyOptional({ example: 2, description: 'DEMO helper: due N minutes from now' })
  @IsOptional()
  @IsInt()
  @Min(1)
  dueInMinutes?: number;

  @ApiPropertyOptional({ example: false, description: 'Also reset due date on existing (not completed) assignments' })
  @IsOptional()
  @IsBoolean()
  updateExisting?: boolean;
}

/* ---------------- Rider: offline sync ---------------- */

export const EVENT_TYPES = ['VIDEO_PROGRESS', 'PDF_VIEWED', 'QUIZ_SUBMITTED'] as const;

export class SyncEventDto {
  @ApiProperty({
    example: '6735a1f04c2b9e1d8a7f3c21',
    description: 'MongoDB ObjectId (24 hex chars) generated on the phone, once per action',
  })
  @IsMongoId()
  eventId: string;

  @ApiProperty({ example: '665f1a2b3c4d5e6f7a8b9c0d' })
  @IsMongoId()
  moduleId: string;

  @ApiProperty({ enum: EVENT_TYPES })
  @IsIn(EVENT_TYPES as unknown as string[])
  type: (typeof EVENT_TYPES)[number];

  @ApiPropertyOptional({
    example: { percent: 95 },
    description:
      'VIDEO_PROGRESS: { percent: 0-100 } · PDF_VIEWED: {} · QUIZ_SUBMITTED: { answers: [{ questionId, selectedIndex }] }',
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;

  @ApiPropertyOptional({ example: '2026-11-12T09:30:00.000Z', description: 'When it happened on the phone (offline time)' })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

export class SyncDto {
  @ApiProperty({ type: [SyncEventDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SyncEventDto)
  events: SyncEventDto[];
}

/* ---------------- Query helpers ---------------- */

export class RiderListQuery {
  @ApiPropertyOptional({ enum: ['blocked', 'active'] }) @IsOptional() @IsIn(['blocked', 'active']) status?: string;
  @ApiPropertyOptional({ example: 'Riyadh' }) @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional({ description: 'Search name or phone' }) @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional({ example: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ example: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}
