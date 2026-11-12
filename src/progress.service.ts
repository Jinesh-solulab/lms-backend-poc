import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Lang } from './common/messages';
import { blockInfo, fileView, loc } from './common/util';
import { SyncEventDto } from './dto';
import { DbModel, M } from './schemas';
import { fileUrl } from './config';

type Ctx = { module: any; quiz: any };

@Injectable()
export class ProgressService {
  constructor(
    @InjectModel(M.TrainingModule) private modules: DbModel,
    @InjectModel(M.Quiz) private quizzes: DbModel,
    @InjectModel(M.Assignment) private assignments: DbModel,
    @InjectModel(M.ProgressEvent) private events: DbModel,
    @InjectModel(M.ModuleProgress) private progress: DbModel,
    @InjectModel(M.QuizAttempt) private attempts: DbModel,
    @InjectModel(M.User) private users: DbModel,
    @InjectModel(M.BlockLog) private logs: DbModel,
  ) {}

  /* ---------------- views ---------------- */

  /** Pure function: what is required for this module and how far the rider is. */
  buildProgressView(module: any, quiz: any, p: any, a: any) {
    p = p || {};
    const required = { video: !!module?.video?.path, pdf: !!module?.pdf?.path, quiz: !!quiz?.questions?.length };
    const done = { video: !!p.videoCompleted, pdf: !!p.pdfViewed, quiz: !!p.quizPassed };
    const steps = (['video', 'pdf', 'quiz'] as const).filter((k) => required[k]);
    const doneSteps = steps.filter((k) => done[k]).length;
    return {
      moduleId: String(module?._id || a?.moduleId),
      required,
      videoPercent: p.videoPercent ?? 0,
      videoCompleted: done.video,
      pdfViewed: done.pdf,
      quizAttempts: p.quizAttempts ?? 0,
      lastScore: p.lastScore ?? null,
      bestScore: p.bestScore ?? null,
      quizTotal: quiz?.questions?.length ?? 0,
      quizPassMark: quiz?.passMark ?? null,
      quizPassed: done.quiz,
      percent: steps.length ? Math.round((doneSteps / steps.length) * 100) : 0,
      completed: !!p.completed,
      completedAt: p.completedAt || null,
      assignmentStatus: a?.status || null,
      dueAt: a?.dueAt || null,
    };
  }

  quizResultView(attempt: any, duplicate: boolean) {
    return {
      eventId: String(attempt.eventId),
      moduleId: String(attempt.moduleId),
      score: attempt.score,
      total: attempt.total,
      passMark: attempt.passMark,
      passed: attempt.passed,
      attemptedAt: attempt.attemptedAt,
      duplicate,
    };
  }

  /** Rider home screen: my assigned modules in my language with progress. */
  async riderModules(user: any, lang: Lang) {
    const as = await this.assignments.find({ userId: user._id }).sort({ dueAt: 1 }).lean();
    const ids = as.map((a) => a.moduleId);
    const [mods, quizzes, progs] = await Promise.all([
      this.modules.find({ _id: { $in: ids }, isActive: true }).lean(),
      this.quizzes.find({ moduleId: { $in: ids } }).lean(),
      this.progress.find({ userId: user._id, moduleId: { $in: ids } }).lean(),
    ]);
    const mMap = new Map<string, any>(mods.map((m) => [String(m._id), m]));
    const qMap = new Map<string, any>(quizzes.map((q) => [String(q.moduleId), q]));
    const pMap = new Map<string, any>(progs.map((p) => [String(p.moduleId), p]));
    const now = Date.now();

    return as
      .filter((a) => mMap.has(String(a.moduleId)))
      .map((a) => {
        const id = String(a.moduleId);
        const m = mMap.get(id);
        const q = qMap.get(id);
        return {
          moduleId: id,
          title: loc(m.title, lang),
          description: loc(m.description, lang),
          version: m.version,
          dueAt: a.dueAt,
          status: a.status,
          isOverdue: a.status === 'overdue' || (a.status === 'assigned' && new Date(a.dueAt).getTime() < now),
          hasVideo: !!m.video?.path,
          hasPdf: !!m.pdf?.path,
          hasQuiz: !!q?.questions?.length,
          downloadSizeBytes: (m.video?.sizeBytes || 0) + (m.pdf?.sizeBytes || 0),
          progress: this.buildProgressView(m, q, pMap.get(id), a),
        };
      });
  }

  /** Everything the app needs to store for offline use. Correct answers are never sent. */
  async modulePackage(user: any, moduleId: string, lang: Lang | 'all') {
    const [m, q, a] = await Promise.all([
      this.modules.findById(moduleId).lean(),
      this.quizzes.findOne({ moduleId }).lean(),
      this.assignments.findOne({ userId: user._id, moduleId }).lean(),
    ]);
    if (!m || !m.isActive) return { error: 'module_not_found' as const };
    if (!a) return { error: 'not_assigned' as const };
    const L = (v: any) => (lang === 'all' ? { ar: v?.ar || '', en: v?.en || '', ur: v?.ur || '' } : loc(v, lang));

    return {
      data: {
        moduleId: String(m._id),
        version: m.version,
        language: lang,
        title: L(m.title),
        description: L(m.description),
        dueAt: a.dueAt,
        status: a.status,
        rules: { videoCompletePercent: m.videoCompletePercent, quizPassMark: q?.passMark ?? null },
        video: m.video?.path ? { url: fileUrl(m.video.path), sizeBytes: m.video.sizeBytes, mimeType: m.video.mimeType } : null,
        pdf: m.pdf?.path ? { url: fileUrl(m.pdf.path), sizeBytes: m.pdf.sizeBytes, mimeType: m.pdf.mimeType } : null,
        quiz: q?.questions?.length
          ? {
              passMark: q.passMark,
              totalQuestions: q.questions.length,
              questions: q.questions.map((qq: any) => ({
                id: String(qq._id),
                text: L(qq.text),
                options: qq.options.map((o: any) => L(o)),
              })),
            }
          : null,
        totalSizeBytes: (m.video?.sizeBytes || 0) + (m.pdf?.sizeBytes || 0),
      },
    };
  }

  async moduleProgress(user: any, moduleId: string) {
    const [m, q, a, p] = await Promise.all([
      this.modules.findById(moduleId).lean(),
      this.quizzes.findOne({ moduleId }).lean(),
      this.assignments.findOne({ userId: user._id, moduleId }).lean(),
      this.progress.findOne({ userId: user._id, moduleId }).lean(),
    ]);
    if (!m) return { error: 'module_not_found' as const };
    if (!a) return { error: 'not_assigned' as const };
    return { data: this.buildProgressView(m, q, p, a) };
  }

  /* ---------------- offline sync ---------------- */

  private async ctx(moduleId: string, cache: Map<string, Ctx>): Promise<Ctx> {
    if (!cache.has(moduleId)) {
      const [module, quiz] = await Promise.all([
        this.modules.findById(moduleId).lean(),
        this.quizzes.findOne({ moduleId }).lean(),
      ]);
      cache.set(moduleId, { module, quiz });
    }
    return cache.get(moduleId);
  }

  private validatePayload(e: SyncEventDto): string | null {
    if (e.type === 'VIDEO_PROGRESS') {
      const p = Number(e.payload?.percent);
      if (!Number.isFinite(p) || p < 0 || p > 100) return 'invalid_percent';
    }
    if (e.type === 'QUIZ_SUBMITTED') {
      const ans = e.payload?.answers;
      if (!Array.isArray(ans) || !ans.length) return 'invalid_answers';
    }
    return null;
  }

  /**
   * Batch sync. Each event has a phone-generated eventId; (userId, eventId) is unique in Mongo,
   * so the same event sent twice (weak network retry) is stored and counted only once.
   */
  async sync(user: any, events: SyncEventDto[]) {
    const cache = new Map<string, Ctx>();
    const sorted = [...events].sort(
      (a, b) => new Date(a.occurredAt || 0).getTime() - new Date(b.occurredAt || 0).getTime(),
    );
    const moduleIds = [...new Set(sorted.map((e) => e.moduleId))];
    const assignedRows = await this.assignments
      .find({ userId: user._id, moduleId: { $in: moduleIds } })
      .select('moduleId')
      .lean();
    const assigned = new Set(assignedRows.map((a) => String(a.moduleId)));

    const results: any[] = [];
    const quizResults: any[] = [];
    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;

    for (const e of sorted) {
      if (!assigned.has(e.moduleId)) {
        rejected++;
        results.push({ eventId: e.eventId, status: 'rejected', reason: 'not_assigned' });
        continue;
      }
      const bad = this.validatePayload(e);
      if (bad) {
        rejected++;
        results.push({ eventId: e.eventId, status: 'rejected', reason: bad });
        continue;
      }

      let doc: any;
      let isDuplicate = false;
      try {
        doc = await this.events.create({
          eventId: e.eventId,
          userId: user._id,
          moduleId: e.moduleId,
          type: e.type,
          payload: e.payload || {},
          occurredAt: e.occurredAt ? new Date(e.occurredAt) : new Date(),
        });
      } catch (err: any) {
        if (err?.code !== 11000) throw err;
        isDuplicate = true;
        doc = await this.events.findOne({ userId: user._id, eventId: e.eventId }).lean();
      }

      if (isDuplicate && doc?.applied) {
        duplicates++;
        if (doc.type === 'QUIZ_SUBMITTED') {
          const prev = await this.attempts.findOne({ userId: user._id, eventId: e.eventId }).lean();
          if (prev) quizResults.push(this.quizResultView(prev, true));
        }
        results.push({ eventId: e.eventId, status: 'duplicate' });
        continue;
      }

      // New event (or a stored one whose effect was never applied, e.g. server crashed mid-way).
      const quizResult = await this.apply(user._id, doc, cache);
      await this.events.updateOne({ _id: doc._id }, { $set: { applied: true, appliedAt: new Date() } });
      if (quizResult) quizResults.push(quizResult);
      accepted++;
      results.push({ eventId: e.eventId, status: 'accepted' });
    }

    const progress = [];
    for (const mid of moduleIds.filter((id) => assigned.has(id))) {
      progress.push(await this.evaluateCompletion(user._id, mid, cache));
    }

    // Auto-unblock: a rider blocked by the deadline cron is unblocked once the overdue training is done.
    let autoUnblock: any = null;
    if (user.isBlocked && progress.some((p) => p.assignmentStatus === 'completed')) {
      autoUnblock = await this.autoUnblockIfDone(user._id);
    }
    const fresh = autoUnblock ? await this.users.findById(user._id).lean() : user;
    const account = {
      isBlocked: !!fresh?.isBlocked,
      autoUnblocked: autoUnblock?.action === 'AUTO_UNBLOCK',
      block: blockInfo(fresh, user.language),
    };

    return { accepted, duplicates, rejected, results, quizResults, progress, account };
  }

  /**
   * Lifts a MODULE_OVERDUE block once the rider has no overdue module left from the current block period.
   * - Manual (admin) blocks are never touched.
   * - "Current block period" = assignments that went overdue at/after blockedAt. Older overdue rows were already
   *   forgiven by an admin unblock (they stay 'overdue' on purpose), so they do not keep the rider blocked.
   * - If the module that caused the block is done but another one is still overdue, the rider stays blocked and
   *   the block reason moves to that module (logged as STILL_BLOCKED).
   * Returns the log entry written, or null when nothing changed.
   */
  async autoUnblockIfDone(userId: Types.ObjectId) {
    const u = await this.users.findById(userId).lean();
    if (!u?.isBlocked || u.blockReason?.kind !== 'MODULE_OVERDUE') return null;

    const causeId = String(u.blockReason.moduleId || '');
    const pending = await this.assignments
      .find({ userId, status: 'overdue', overdueAt: { $gte: u.blockedAt || new Date(0) } })
      .sort({ dueAt: 1 })
      .lean();
    if (pending.some((a) => String(a.moduleId) === causeId)) return null; // the blocking module is still not done

    const causeTitle = u.blockReason.moduleTitle || {};
    const causeName = causeTitle.en || causeTitle.ar || causeId;
    const guard = { _id: userId, isBlocked: true, 'blockReason.kind': 'MODULE_OVERDUE', 'blockReason.moduleId': u.blockReason.moduleId };

    if (pending.length) {
      const next = pending[0];
      const title = (await this.modules.findById(next.moduleId).select('title').lean())?.title || { ar: '', en: '', ur: '' };
      const r = await this.users.updateOne(guard, {
        $set: { blockReason: { kind: 'MODULE_OVERDUE', moduleId: next.moduleId, moduleTitle: title, dueAt: next.dueAt } },
      });
      if (!r.modifiedCount) return null;
      return (
        await this.logs.create({
          userId,
          action: 'STILL_BLOCKED',
          kind: 'MODULE_OVERDUE',
          moduleId: next.moduleId,
          reason: `Completed "${causeName}", but "${title.en || title.ar}" is still overdue (${pending.length} overdue module(s) left)`,
          by: 'SYSTEM',
          dueAt: next.dueAt,
        })
      ).toObject();
    }

    const r = await this.users.updateOne(guard, { $set: { isBlocked: false, blockReason: null, blockedAt: null, blockedBy: null } });
    if (!r.modifiedCount) return null; // admin unblocked / changed it at the same moment
    const blockedForMs = u.blockedAt ? Date.now() - new Date(u.blockedAt).getTime() : null;
    return (
      await this.logs.create({
        userId,
        action: 'AUTO_UNBLOCK',
        kind: 'MODULE_OVERDUE',
        moduleId: u.blockReason.moduleId,
        reason: `Auto-unblocked: rider completed overdue module "${causeName}"` +
          (blockedForMs != null ? ` (was blocked ${Math.round(blockedForMs / 60000)} min)` : ''),
        by: 'SYSTEM',
        dueAt: u.blockReason.dueAt,
      })
    ).toObject();
  }

  private async apply(userId: Types.ObjectId, doc: any, cache: Map<string, Ctx>) {
    const { module, quiz } = await this.ctx(String(doc.moduleId), cache);
    const key = { userId, moduleId: doc.moduleId };
    const now = new Date();

    if (doc.type === 'VIDEO_PROGRESS') {
      const pct = Math.round(Number(doc.payload.percent));
      const update: any = { $max: { videoPercent: pct }, $set: { lastActivityAt: now } };
      if (pct >= (module?.videoCompletePercent ?? 90)) update.$set.videoCompleted = true;
      await this.progress.updateOne(key, update, { upsert: true });
      return null;
    }

    if (doc.type === 'PDF_VIEWED') {
      await this.progress.updateOne(
        key,
        { $set: { pdfViewed: true, pdfViewedAt: doc.occurredAt || now, lastActivityAt: now } },
        { upsert: true },
      );
      return null;
    }

    // QUIZ_SUBMITTED: graded on the server against correctIndex (the app never has the answers).
    if (!quiz?.questions?.length) return { eventId: String(doc.eventId), moduleId: String(doc.moduleId), error: 'quiz_not_found' };
    const answers = new Map<string, number>(
      (doc.payload.answers || []).map((a: any) => [String(a.questionId), Number(a.selectedIndex)]),
    );
    const score = quiz.questions.filter((q: any) => answers.get(String(q._id)) === q.correctIndex).length;
    const total = quiz.questions.length;
    const passed = score >= quiz.passMark;

    let attempt: any;
    try {
      attempt = (
        await this.attempts.create({
          userId,
          moduleId: doc.moduleId,
          eventId: doc.eventId,
          answers: doc.payload.answers.map((a: any) => ({ questionId: String(a.questionId), selectedIndex: Number(a.selectedIndex) })),
          score,
          total,
          passMark: quiz.passMark,
          passed,
          attemptedAt: doc.occurredAt || now,
        })
      ).toObject();
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      attempt = await this.attempts.findOne({ userId, eventId: doc.eventId }).lean();
      return this.quizResultView(attempt, true);
    }

    const update: any = {
      $inc: { quizAttempts: 1 },
      $max: { bestScore: score },
      $set: { lastScore: score, lastActivityAt: now },
    };
    if (passed) update.$set.quizPassed = true;
    await this.progress.updateOne(key, update, { upsert: true });
    return this.quizResultView(attempt, false);
  }

  /** Module is complete when every required part (video / PDF / quiz) is done. Marks the assignment completed. */
  async evaluateCompletion(userId: Types.ObjectId, moduleId: string, cache: Map<string, Ctx>) {
    const { module, quiz } = await this.ctx(moduleId, cache);
    const key = { userId, moduleId };
    const [p, a] = await Promise.all([this.progress.findOne(key).lean(), this.assignments.findOne(key).lean()]);
    const view = this.buildProgressView(module, quiz, p, a);
    const steps = (['video', 'pdf', 'quiz'] as const).filter((k) => view.required[k]);
    const allDone =
      steps.length > 0 &&
      steps.every((k) => (k === 'video' ? view.videoCompleted : k === 'pdf' ? view.pdfViewed : view.quizPassed));

    if (allDone) {
      const now = new Date();
      if (!view.completed) {
        await this.progress.updateOne(key, { $set: { completed: true, completedAt: now } }, { upsert: true });
        view.completed = true;
        view.completedAt = now;
      }
      if (a && a.status !== 'completed') {
        await this.assignments.updateOne({ _id: a._id }, { $set: { status: 'completed', completedAt: now } });
        view.assignmentStatus = 'completed';
      }
    }
    return view;
  }

  /** Admin view of one module with both languages and file URLs. */
  adminModuleView(m: any, quiz: any, counts?: Record<string, number>) {
    return {
      id: String(m._id),
      title: m.title,
      description: m.description,
      video: fileView(m.video),
      pdf: fileView(m.pdf),
      deadlineDays: m.deadlineDays,
      videoCompletePercent: m.videoCompletePercent,
      version: m.version,
      isActive: m.isActive,
      quiz: quiz
        ? {
            passMark: quiz.passMark,
            totalQuestions: quiz.questions.length,
            questions: quiz.questions.map((q: any) => ({
              id: String(q._id),
              text: q.text,
              options: q.options,
              correctIndex: q.correctIndex,
            })),
          }
        : null,
      assignments: counts || undefined,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  }
}
