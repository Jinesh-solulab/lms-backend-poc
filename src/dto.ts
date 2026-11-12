import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
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
export const WORKER_TYPES = ['rider', 'picker', 'bpo'];
type WorkerType = 'rider' | 'picker' | 'bpo';

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

  @ApiProperty({ example: '123456', description: 'Static OTP for the POC (STATIC_OTP in .env)' })
  @IsString()
  otp: string;

  @ApiPropertyOptional({ example: 'Riyadh', description: 'Optional. Saved only when the rider has no city yet (first registration). Used by assignment rules.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  city?: string;
}

export class AdminLoginDto {
  @ApiProperty({ example: 'admin@hs-demo.com' })
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

  @ApiPropertyOptional({ example: 'Riyadh', description: 'Rider can set the city once (while it is empty). After that only an admin can change it.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  city?: string;
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

  @ApiPropertyOptional({ enum: WORKER_TYPES, example: 'rider', default: 'rider' })
  @IsOptional()
  @IsIn(WORKER_TYPES)
  workerType?: WorkerType;

  @ApiPropertyOptional({ example: 'North' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  zone?: string;
}

export class UpdateRiderDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ example: 'Jeddah' }) @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional({ enum: WORKER_TYPES }) @IsOptional() @IsIn(WORKER_TYPES) workerType?: WorkerType;
  @ApiPropertyOptional({ example: 'North' }) @IsOptional() @IsString() @MaxLength(60) zone?: string;
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

  @ApiPropertyOptional({ enum: WORKER_TYPES, description: 'Assign to all riders of this worker type' })
  @IsOptional()
  @IsIn(WORKER_TYPES)
  workerType?: WorkerType;

  @ApiPropertyOptional({ example: 'North', description: 'Assign to all riders in this zone (case-insensitive)' })
  @IsOptional()
  @IsString()
  zone?: string;

  @ApiPropertyOptional({ example: '2026-11-20T18:00:00.000Z', description: 'Exact due date (overrides everything else)' })
  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @ApiPropertyOptional({ example: 2, description: 'DEMO helper: due N minutes from now' })
  @IsOptional()
  @IsInt()
  @Min(1)
  dueInMinutes?: number;

  @ApiPropertyOptional({ example: 7, description: 'Due N days from now. Default: the module deadlineDays (then 7)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  deadlineDays?: number;

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
  @ApiPropertyOptional({ enum: WORKER_TYPES }) @IsOptional() @IsIn(WORKER_TYPES) workerType?: string;
  @ApiPropertyOptional({ description: 'Search name or phone' }) @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional({ example: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ example: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class RoosterRiderQuery extends RiderListQuery {
  @ApiPropertyOptional({
    enum: ['incomplete', 'complete', 'all'],
    default: 'incomplete',
    description: 'incomplete = riders with at least one module not completed (default)',
  })
  @IsOptional()
  @IsIn(['incomplete', 'complete', 'all'])
  training?: 'incomplete' | 'complete' | 'all';
}

/* ---------------- Admin: assignment rules ---------------- */

export class RuleCriteriaDto {
  @ApiPropertyOptional({ example: 'Riyadh', description: 'Empty / null = any city. Case-insensitive.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  city?: string | null;

  @ApiPropertyOptional({ enum: WORKER_TYPES, description: 'Empty / null = any worker type' })
  @IsOptional()
  @IsIn(WORKER_TYPES)
  workerType?: WorkerType | null;

  @ApiPropertyOptional({ example: 'North', description: 'Empty / null = any zone' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  zone?: string | null;
}

export class CreateRuleDto {
  @ApiProperty({ example: 'Riyadh riders -> Road Safety' })
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiProperty({ example: '6735a1f04c2b9e1d8a7f3c30' })
  @IsMongoId()
  moduleId: string;

  @ApiPropertyOptional({ type: RuleCriteriaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RuleCriteriaDto)
  criteria?: RuleCriteriaDto;

  @ApiPropertyOptional({ example: 7, description: 'Due = the moment a rider matches + N days. Default: the module deadlineDays' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  deadlineDays?: number;

  @ApiPropertyOptional({ example: 3, description: 'DEMO: due N minutes after matching (overrides deadlineDays). Send null to clear.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  deadlineMinutes?: number | null;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 120) name?: string;
  @ApiPropertyOptional({ type: RuleCriteriaDto }) @IsOptional() @ValidateNested() @Type(() => RuleCriteriaDto) criteria?: RuleCriteriaDto;
  @ApiPropertyOptional({ example: 7 }) @IsOptional() @IsInt() @Min(1) @Max(365) deadlineDays?: number;
  @ApiPropertyOptional({ example: 3 }) @IsOptional() @IsInt() @Min(1) @Max(100000) deadlineMinutes?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class RulePreviewDto {
  @ApiPropertyOptional({ type: RuleCriteriaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RuleCriteriaDto)
  criteria?: RuleCriteriaDto;

  @ApiPropertyOptional({ example: '6735a1f04c2b9e1d8a7f3c30', description: 'Optional: also returns alreadyAssigned / willAssign for this module' })
  @IsOptional()
  @IsMongoId()
  moduleId?: string;
}

export class RuleListQuery {
  @ApiPropertyOptional({ example: '6735a1f04c2b9e1d8a7f3c30' }) @IsOptional() @IsMongoId() moduleId?: string;
}

/* ---------------- Admin: dashboard filters ---------------- */

export class DashboardFilterQuery {
  @ApiPropertyOptional({ example: '6735a1f04c2b9e1d8a7f3c30' }) @IsOptional() @IsMongoId() moduleId?: string;
  @ApiPropertyOptional({ example: 'Riyadh' }) @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional({ enum: WORKER_TYPES }) @IsOptional() @IsIn(WORKER_TYPES) workerType?: string;
  @ApiPropertyOptional({ example: 'North' }) @IsOptional() @IsString() zone?: string;
  @ApiPropertyOptional({ example: '2026-11-01', description: 'assignedAt from (inclusive)' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ example: '2026-11-30', description: 'assignedAt to (inclusive; a date-only value covers the whole day, Riyadh time)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ByGroupQuery extends DashboardFilterQuery {
  @ApiPropertyOptional({ enum: ['city', 'workerType', 'zone'], default: 'city' }) @IsOptional() @IsIn(['city', 'workerType', 'zone']) groupBy?: string;
}

export class TrendQuery extends DashboardFilterQuery {
  @ApiPropertyOptional({ example: 30, description: '1-180, default 30' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(180) days?: number;
}

export class NonCompliantQuery extends DashboardFilterQuery {
  @ApiPropertyOptional({ example: 50, description: '1-500, default 50' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
  @ApiPropertyOptional({ example: false, description: 'Also include riders who completed late' }) @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() includeLate?: boolean;
}

export class ExportQuery extends DashboardFilterQuery {
  @ApiPropertyOptional({ enum: ['summary', 'by-city', 'by-module', 'non-compliant'], default: 'non-compliant' })
  @IsOptional()
  @IsIn(['summary', 'by-city', 'by-module', 'non-compliant'])
  type?: string;
}
