import { Schema } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;

/** Model names. */
export const M = {
  User: 'User',
  TrainingModule: 'TrainingModule',
  Quiz: 'Quiz',
  Assignment: 'Assignment',
  ProgressEvent: 'ProgressEvent',
  ModuleProgress: 'ModuleProgress',
  QuizAttempt: 'QuizAttempt',
  BlockLog: 'BlockLog',
  AssignmentRule: 'AssignmentRule',
} as const;

/** Text in every app language. Urdu is optional: riders fall back to English when it is empty (see loc()). */
const localized = () =>
  new Schema(
    { ar: { type: String, default: '' }, en: { type: String, default: '' }, ur: { type: String, default: '' } },
    { _id: false },
  );

const FileSchema = new Schema(
  { path: String, originalName: String, sizeBytes: Number, mimeType: String, uploadedAt: Date },
  { _id: false },
);

const BlockReasonSchema = new Schema(
  {
    kind: { type: String, enum: ['MODULE_OVERDUE', 'MANUAL'] },
    moduleId: { type: ObjectId, ref: M.TrainingModule },
    moduleTitle: localized(),
    dueAt: Date,
    note: String,
  },
  { _id: false },
);

export const UserSchema = new Schema(
  {
    phone: { type: String, unique: true, sparse: true },
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    password: { type: String, select: false },
    name: { type: String, default: '' },
    role: { type: String, enum: ['rider', 'admin'], default: 'rider', index: true },
    city: { type: String, default: null, index: true },
    // rider | picker | bpo. Old rows without it count as 'rider' (see workerTypeFilter()).
    workerType: { type: String, enum: ['rider', 'picker', 'bpo'], default: 'rider', index: true },
    zone: { type: String, default: null, index: true },
    avatar: { type: FileSchema, default: null }, // profile photo (local disk, /uploads/avatars)
    language: { type: String, enum: ['ar', 'en', 'ur'], default: 'en' },
    isActive: { type: Boolean, default: true },
    isBlocked: { type: Boolean, default: false, index: true },
    blockReason: { type: BlockReasonSchema, default: null },
    blockedAt: { type: Date, default: null },
    blockedBy: { type: String, default: null }, // 'SYSTEM' or admin id
    lastLoginAt: Date,
  },
  { timestamps: true, collection: 'users' },
);

export const TrainingModuleSchema = new Schema(
  {
    title: { type: localized(), required: true },
    description: { type: localized(), default: () => ({}) },
    video: { type: FileSchema, default: null },
    pdf: { type: FileSchema, default: null },
    deadlineDays: { type: Number, default: 7 },
    videoCompletePercent: { type: Number, default: 90 },
    version: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: ObjectId, ref: M.User },
  },
  { timestamps: true, collection: 'modules' },
);

const QuestionSchema = new Schema({
  text: { type: localized(), required: true },
  options: { type: [localized()], required: true },
  correctIndex: { type: Number, required: true },
});

export const QuizSchema = new Schema(
  {
    moduleId: { type: ObjectId, ref: M.TrainingModule, required: true, unique: true },
    passMark: { type: Number, required: true }, // e.g. 3 correct out of 5
    questions: { type: [QuestionSchema], default: [] },
  },
  { timestamps: true, collection: 'quizzes' },
);

export const AssignmentSchema = new Schema(
  {
    userId: { type: ObjectId, ref: M.User, required: true },
    moduleId: { type: ObjectId, ref: M.TrainingModule, required: true },
    assignedAt: { type: Date, default: Date.now },
    dueAt: { type: Date, required: true },
    status: { type: String, enum: ['assigned', 'completed', 'overdue'], default: 'assigned' },
    completedAt: { type: Date, default: null },
    overdueAt: { type: Date, default: null },
    assignedBy: { type: ObjectId, ref: M.User },
    ruleId: { type: ObjectId, ref: 'AssignmentRule', default: null }, // set when an assignment rule created this row
  },
  { timestamps: true, collection: 'assignments' },
);
AssignmentSchema.index({ userId: 1, moduleId: 1 }, { unique: true });
AssignmentSchema.index({ status: 1, dueAt: 1 }); // used by the deadline cron

/** Every offline/online action. Unique (userId, eventId) is what stops double counting on re-sync. */
export const ProgressEventSchema = new Schema(
  {
    eventId: { type: ObjectId, required: true }, // generated on the phone
    userId: { type: ObjectId, ref: M.User, required: true },
    moduleId: { type: ObjectId, ref: M.TrainingModule, required: true },
    type: { type: String, enum: ['VIDEO_PROGRESS', 'PDF_VIEWED', 'QUIZ_SUBMITTED'], required: true },
    payload: { type: Mixed, default: {} },
    occurredAt: { type: Date, required: true },
    applied: { type: Boolean, default: false },
    appliedAt: Date,
  },
  { timestamps: { createdAt: 'receivedAt', updatedAt: false }, collection: 'progress_events', minimize: false },
);
ProgressEventSchema.index({ userId: 1, eventId: 1 }, { unique: true });

/** One row per rider + module. No defaults on purpose: fields are updated with $max/$inc upserts. */
export const ModuleProgressSchema = new Schema(
  {
    userId: { type: ObjectId, ref: M.User, required: true },
    moduleId: { type: ObjectId, ref: M.TrainingModule, required: true },
    videoPercent: Number,
    videoCompleted: Boolean,
    pdfViewed: Boolean,
    pdfViewedAt: Date,
    quizAttempts: Number,
    bestScore: Number,
    lastScore: Number,
    quizPassed: Boolean,
    completed: Boolean,
    completedAt: Date,
    lastActivityAt: Date,
  },
  { timestamps: true, collection: 'module_progress' },
);
ModuleProgressSchema.index({ userId: 1, moduleId: 1 }, { unique: true });
ModuleProgressSchema.index({ moduleId: 1 });

export const QuizAttemptSchema = new Schema(
  {
    userId: { type: ObjectId, ref: M.User, required: true },
    moduleId: { type: ObjectId, ref: M.TrainingModule, required: true },
    eventId: { type: ObjectId, required: true },
    answers: [{ _id: false, questionId: String, selectedIndex: Number }],
    score: Number,
    total: Number,
    passMark: Number,
    passed: Boolean,
    attemptedAt: Date,
  },
  { timestamps: true, collection: 'quiz_attempts' },
);
QuizAttemptSchema.index({ userId: 1, eventId: 1 }, { unique: true });
QuizAttemptSchema.index({ moduleId: 1, userId: 1 });

export const BlockLogSchema = new Schema(
  {
    userId: { type: ObjectId, ref: M.User, required: true, index: true },
    // AUTO_UNBLOCK = rider finished the overdue module(s) and the system lifted the block.
    // STILL_BLOCKED = rider finished the module that caused the block, but another module is still overdue.
    action: { type: String, enum: ['BLOCK', 'UNBLOCK', 'OVERDUE', 'AUTO_UNBLOCK', 'STILL_BLOCKED'], required: true },
    kind: { type: String, enum: ['MODULE_OVERDUE', 'MANUAL'], default: 'MANUAL' },
    moduleId: { type: ObjectId, ref: M.TrainingModule, default: null },
    reason: String,
    note: String,
    by: { type: String, required: true }, // 'SYSTEM' or admin id
    dueAt: Date,
    newDueAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'block_logs' },
);

/** Saved "who gets this module" rule. Applied on create and whenever a rider is created / changes city, worker type or zone. */
export const AssignmentRuleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    moduleId: { type: ObjectId, ref: M.TrainingModule, required: true, index: true },
    criteria: {
      city: { type: String, default: null }, // null = any city (case-insensitive, trimmed)
      workerType: { type: String, default: null }, // null = any
      zone: { type: String, default: null }, // null = any
    },
    deadlineDays: { type: Number, default: 7 },
    deadlineMinutes: { type: Number, default: null }, // DEMO: overrides deadlineDays when set
    isActive: { type: Boolean, default: true, index: true },
    assignedCount: { type: Number, default: 0 },
    lastRunAt: { type: Date, default: null },
    createdBy: { type: ObjectId, ref: M.User },
  },
  { timestamps: true, collection: 'assignment_rules', minimize: false },
);

export const ALL_SCHEMAS = [
  { name: M.User, schema: UserSchema },
  { name: M.TrainingModule, schema: TrainingModuleSchema },
  { name: M.Quiz, schema: QuizSchema },
  { name: M.Assignment, schema: AssignmentSchema },
  { name: M.ProgressEvent, schema: ProgressEventSchema },
  { name: M.ModuleProgress, schema: ModuleProgressSchema },
  { name: M.QuizAttempt, schema: QuizAttemptSchema },
  { name: M.BlockLog, schema: BlockLogSchema },
  { name: M.AssignmentRule, schema: AssignmentRuleSchema },
];

/** POC: loose model typing (mongoose lean() unions are noisy with Model<any>). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbModel = any;
