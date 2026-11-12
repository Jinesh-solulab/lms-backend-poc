import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Types } from 'mongoose';
import { Auth } from './common/auth';
import { AppException, ok } from './common/http';
import { riderFilter } from './common/meta';
import { ByGroupQuery, DashboardFilterQuery, ExportQuery, NonCompliantQuery, TrendQuery } from './dto';
import { ProgressService } from './progress.service';
import { DbModel, M } from './schemas';

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const statusSum = (s: string) => ({ $sum: { $cond: [{ $eq: ['$status', s] }, 1, 0] } });
const when = (cond: any) => ({ $sum: { $cond: [cond, 1, 0] } });

const TZ = 'Asia/Riyadh';
const TZ_OFFSET_MS = 3 * 3_600_000; // Saudi Arabia: UTC+3, no DST
const DAY_MS = 86_400_000;
const isDateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const riyadhDay = (t: number) => new Date(t + TZ_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Compliance buckets (one definition for every endpoint):
 *   onTime    = completed and completedAt <= dueAt
 *   late      = completed and completedAt >  dueAt
 *   pastDue   = not completed and dueAt < now   (overdue, whether or not the cron has flagged it yet)
 *   notDueYet = not completed and dueAt >= now
 *   complianceRate = onTime / (onTime + late + pastDue)   -> not-yet-due rows are left out
 */
const complianceGroup = (now: Date) => ({
  totalAssignments: { $sum: 1 },
  completed: statusSum('completed'),
  pending: statusSum('assigned'),
  overdue: statusSum('overdue'),
  onTime: when({ $and: [{ $eq: ['$status', 'completed'] }, { $lte: ['$completedAt', '$dueAt'] }] }),
  late: when({ $and: [{ $eq: ['$status', 'completed'] }, { $gt: ['$completedAt', '$dueAt'] }] }),
  pastDue: when({ $and: [{ $ne: ['$status', 'completed'] }, { $lt: ['$dueAt', now] }] }),
  notDueYet: when({ $and: [{ $ne: ['$status', 'completed'] }, { $gte: ['$dueAt', now] }] }),
});

const EMPTY = { totalAssignments: 0, completed: 0, pending: 0, overdue: 0, onTime: 0, late: 0, pastDue: 0, notDueYet: 0 };

function withRates(o: any) {
  const due = (o.onTime || 0) + (o.late || 0) + (o.pastDue || 0);
  return {
    ...o,
    completionRate: pct(o.completed || 0, o.totalAssignments || 0),
    overdueRate: pct(o.overdue || 0, o.totalAssignments || 0),
    complianceRate: pct(o.onTime || 0, due),
    dueAssignments: due,
  };
}

const csvCell = (v: any) => {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (headers: string[], rows: any[][]) =>
  '﻿' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; // BOM: Excel shows Arabic correctly

@ApiTags('Admin - Dashboard')
@Auth('admin')
@Controller('admin/dashboard')
export class DashboardController {
  constructor(
    private progress: ProgressService,
    @InjectModel(M.User) private users: DbModel,
    @InjectModel(M.TrainingModule) private modules: DbModel,
    @InjectModel(M.Quiz) private quizzes: DbModel,
    @InjectModel(M.Assignment) private assignments: DbModel,
    @InjectModel(M.ModuleProgress) private progressRows: DbModel,
  ) {}

  /* ---------------- shared filters ---------------- */

  private hasRiderFilter(q: DashboardFilterQuery) {
    return !!(q.city || q.workerType || q.zone);
  }

  /** $match on assignments for moduleId / city / workerType / zone / from / to (assignedAt). */
  private async assignmentMatch(q: DashboardFilterQuery): Promise<any> {
    const m: any = {};
    if (q.moduleId) m.moduleId = new Types.ObjectId(q.moduleId);
    if (q.from || q.to) {
      m.assignedAt = {};
      if (q.from) m.assignedAt.$gte = isDateOnly(q.from) ? new Date(`${q.from}T00:00:00+03:00`) : new Date(q.from);
      if (q.to) m.assignedAt.$lte = isDateOnly(q.to) ? new Date(`${q.to}T23:59:59.999+03:00`) : new Date(q.to);
    }
    if (this.hasRiderFilter(q)) {
      const ids = await this.users.find(riderFilter(q, false)).distinct('_id');
      m.userId = { $in: ids };
    }
    return m;
  }

  private async compliance(match: any, now: Date) {
    const [r] = await this.assignments.aggregate([{ $match: match }, { $group: { _id: null, ...complianceGroup(now) } }]);
    const { _id, ...rest } = r || { _id: null, ...EMPTY };
    return withRates(rest);
  }

  /* ---------------- data builders (also used by the CSV export) ---------------- */

  private async summaryData(q: DashboardFilterQuery) {
    const now = new Date();
    const match = await this.assignmentMatch(q);
    const rf = riderFilter(q, false);
    const [totalRiders, blockedRiders, totalModules, c, inProgressRows] = await Promise.all([
      this.users.countDocuments(rf),
      this.users.countDocuments({ ...rf, isBlocked: true }),
      q.moduleId ? this.modules.countDocuments({ _id: q.moduleId }) : this.modules.countDocuments({ isActive: true }),
      this.compliance(match, now),
      this.assignments.aggregate([
        { $match: { ...match, status: { $ne: 'completed' } } },
        {
          $lookup: {
            from: 'module_progress',
            let: { u: '$userId', mo: '$moduleId' },
            pipeline: [
              { $match: { $expr: { $and: [{ $eq: ['$userId', '$$u'] }, { $eq: ['$moduleId', '$$mo'] }] } } },
              { $project: { videoPercent: 1, pdfViewed: 1, quizAttempts: 1 } },
            ],
            as: 'p',
          },
        },
        { $unwind: '$p' },
        { $match: { $or: [{ 'p.videoPercent': { $gt: 0 } }, { 'p.pdfViewed': true }, { 'p.quizAttempts': { $gt: 0 } }] } },
        { $count: 'c' },
      ]),
    ]);
    const inProgress = inProgressRows[0]?.c || 0;
    return {
      filters: { moduleId: q.moduleId || null, city: q.city || null, workerType: q.workerType || null, zone: q.zone || null, from: q.from || null, to: q.to || null },
      totalRiders,
      activeRiders: totalRiders - blockedRiders,
      blockedRiders,
      totalModules,
      ...c,
      inProgress,
      notStarted: Math.max(c.pending + c.overdue - inProgress, 0),
      generatedAt: now,
    };
  }

  private async byGroupData(q: ByGroupQuery) {
    const now = new Date();
    const field = q.groupBy || 'city';
    const fallback = field === 'workerType' ? 'rider' : 'Unknown';
    const match = await this.assignmentMatch(q);
    const [rows, riders] = await Promise.all([
      this.assignments.aggregate([
        { $match: match },
        { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'u' } },
        { $unwind: '$u' },
        { $group: { _id: { $ifNull: [`$u.${field}`, fallback] }, ...complianceGroup(now) } },
      ]),
      this.users.aggregate([
        { $match: riderFilter(q, false) },
        { $group: { _id: { $ifNull: [`$${field}`, fallback] }, riders: { $sum: 1 }, blocked: { $sum: { $cond: ['$isBlocked', 1, 0] } } } },
      ]),
    ]);
    const map = new Map<string, any>();
    for (const r of riders) map.set(r._id, { [field]: r._id, riders: r.riders, blockedRiders: r.blocked, ...EMPTY });
    for (const r of rows) {
      const { _id, ...rest } = r;
      map.set(_id, { ...(map.get(_id) || { [field]: _id, riders: 0, blockedRiders: 0 }), ...rest });
    }
    return [...map.values()].map(withRates).sort((a, b) => b.riders - a.riders || b.totalAssignments - a.totalAssignments);
  }

  private async byModuleData(q: DashboardFilterQuery) {
    const now = new Date();
    const match = await this.assignmentMatch(q);
    const [rows, mods] = await Promise.all([
      this.assignments.aggregate([{ $match: match }, { $group: { _id: '$moduleId', ...complianceGroup(now) } }]),
      this.modules.find(q.moduleId ? { _id: q.moduleId } : { isActive: true }).select('title version isActive').lean(),
    ]);
    const rMap = new Map<string, any>(rows.map((r) => [String(r._id), r]));
    const extraIds = rows.map((r) => String(r._id)).filter((id) => !mods.some((m) => String(m._id) === id));
    const extra = extraIds.length ? await this.modules.find({ _id: { $in: extraIds } }).select('title version isActive').lean() : [];
    return [...mods, ...extra]
      .map((m) => {
        const { _id, ...rest } = rMap.get(String(m._id)) || { _id: null, ...EMPTY };
        return withRates({ moduleId: String(m._id), title: m.title, version: m.version, isActive: m.isActive, ...rest });
      })
      .sort((a, b) => b.totalAssignments - a.totalAssignments);
  }

  private async nonCompliantData(q: NonCompliantQuery) {
    const now = new Date();
    const match = await this.assignmentMatch(q);
    const cond: any[] = [{ status: { $ne: 'completed' }, dueAt: { $lt: now } }];
    if (q.includeLate) cond.push({ status: 'completed', $expr: { $gt: ['$completedAt', '$dueAt'] } });
    const rows = await this.assignments
      .find({ ...match, $or: cond })
      .sort({ dueAt: 1 })
      .limit(q.limit || 50)
      .lean();
    const [users, mods] = await Promise.all([
      this.users.find({ _id: { $in: rows.map((r) => r.userId) } }).select('name phone city workerType zone isBlocked blockReason').lean(),
      this.modules.find({ _id: { $in: rows.map((r) => r.moduleId) } }).select('title').lean(),
    ]);
    const uMap = new Map<string, any>(users.map((u) => [String(u._id), u]));
    const mMap = new Map<string, any>(mods.map((m) => [String(m._id), m]));
    return rows.map((a) => {
      const u = uMap.get(String(a.userId));
      const m = mMap.get(String(a.moduleId));
      const late = a.status === 'completed';
      const end = late ? new Date(a.completedAt).getTime() : now.getTime();
      return {
        assignmentId: String(a._id),
        compliance: late ? 'late' : 'overdue',
        status: a.status,
        rider: u
          ? { id: String(u._id), name: u.name, phone: u.phone, city: u.city || null, workerType: u.workerType || 'rider', zone: u.zone || null }
          : null,
        module: m ? { id: String(m._id), title: m.title } : { id: String(a.moduleId), title: null },
        assignedAt: a.assignedAt,
        dueAt: a.dueAt,
        completedAt: a.completedAt || null,
        daysOverdue: Math.round(((end - new Date(a.dueAt).getTime()) / DAY_MS) * 10) / 10,
        isBlocked: !!u?.isBlocked,
        blockedForThisModule: !!u?.isBlocked && String(u?.blockReason?.moduleId || '') === String(a.moduleId),
        assignedByRule: !!a.ruleId,
      };
    });
  }

  /* ---------------- endpoints ---------------- */

  @Get('summary')
  @ApiOperation({
    summary: 'Top numbers + compliance (onTime, late, pastDue, complianceRate). Filters: moduleId, city, workerType, zone, from, to',
    description: 'complianceRate = completed on or before dueAt / (completed + past due). Not-yet-due assignments are left out.',
  })
  async summary(@Query() q: DashboardFilterQuery) {
    return ok('dashboard', await this.summaryData(q));
  }

  @Get('by-city')
  @ApiOperation({ summary: 'Per city (or ?groupBy=workerType|zone): riders, blocked, completion, overdue, compliance. Same filters as summary' })
  async byCity(@Query() q: ByGroupQuery) {
    return ok('dashboard', await this.byGroupData(q));
  }

  @Get('by-module')
  @ApiOperation({ summary: 'One row per module with completion + compliance. Same filters as summary' })
  async byModule(@Query() q: DashboardFilterQuery) {
    return ok('dashboard', await this.byModuleData(q));
  }

  @Get('trend')
  @ApiOperation({
    summary: 'Daily series for the last N days (Riyadh time): [{ date, completed, onTime, late, overdue }]',
    description: 'completed = completions that day. overdue = assignments whose deadline fell that day and were not completed by it.',
  })
  async trend(@Query() q: TrendQuery) {
    const days = q.days || 30;
    const now = new Date();
    const start = new Date(Date.parse(`${riyadhDay(now.getTime())}T00:00:00+03:00`) - (days - 1) * DAY_MS);
    const match = await this.assignmentMatch(q);
    const dayOf = (f: string) => ({ $dateToString: { format: '%Y-%m-%d', date: f, timezone: TZ } });
    const [done, missed] = await Promise.all([
      this.assignments.aggregate([
        { $match: { ...match, status: 'completed', completedAt: { $gte: start } } },
        {
          $group: {
            _id: dayOf('$completedAt'),
            completed: { $sum: 1 },
            onTime: when({ $lte: ['$completedAt', '$dueAt'] }),
            late: when({ $gt: ['$completedAt', '$dueAt'] }),
          },
        },
      ]),
      this.assignments.aggregate([
        {
          $match: {
            ...match,
            dueAt: { $gte: start, $lt: now },
            $or: [{ status: { $ne: 'completed' } }, { $expr: { $gt: ['$completedAt', '$dueAt'] } }],
          },
        },
        { $group: { _id: dayOf('$dueAt'), overdue: { $sum: 1 } } },
      ]),
    ]);
    const dMap = new Map<string, any>(done.map((d) => [d._id, d]));
    const oMap = new Map<string, number>(missed.map((d) => [d._id, d.overdue]));
    const series = [];
    for (let i = 0; i < days; i++) {
      const date = riyadhDay(start.getTime() + i * DAY_MS);
      const d = dMap.get(date);
      series.push({ date, completed: d?.completed || 0, onTime: d?.onTime || 0, late: d?.late || 0, overdue: oMap.get(date) || 0 });
    }
    return ok('dashboard', series);
  }

  @Get('non-compliant')
  @ApiOperation({ summary: 'Overdue riders (oldest deadline first) with module, due date, days overdue and blocked flag. ?includeLate=true adds late completions' })
  async nonCompliant(@Query() q: NonCompliantQuery) {
    return ok('dashboard', await this.nonCompliantData(q));
  }

  @Get('export.csv')
  @ApiProduces('text/csv')
  @ApiQuery({ name: 'access_token', required: false, description: 'JWT for plain browser download links (instead of the Authorization header)' })
  @ApiOperation({ summary: 'CSV download: ?type=summary|by-city|by-module|non-compliant (default non-compliant) + the same filters. UTF-8 with BOM' })
  async exportCsv(@Query() q: ExportQuery, @Res() res: any) {
    const type = q.type || 'non-compliant';
    const T = (t: any) => t?.en || t?.ar || '';
    let csv: string;
    if (type === 'summary') {
      const s: any = await this.summaryData(q);
      const keys = Object.keys(s).filter((k) => k !== 'filters' && k !== 'generatedAt');
      csv = toCsv(['metric', 'value'], [...keys.map((k) => [k, s[k]]), ['generatedAt', s.generatedAt]]);
    } else if (type === 'by-city') {
      const rows = await this.byGroupData({ ...q, groupBy: 'city' });
      csv = toCsv(
        ['city', 'riders', 'blockedRiders', 'totalAssignments', 'completed', 'onTime', 'late', 'pastDue', 'notDueYet', 'completionRate', 'complianceRate'],
        rows.map((r) => [r.city, r.riders, r.blockedRiders, r.totalAssignments, r.completed, r.onTime, r.late, r.pastDue, r.notDueYet, r.completionRate, r.complianceRate]),
      );
    } else if (type === 'by-module') {
      const rows = await this.byModuleData(q);
      csv = toCsv(
        ['moduleId', 'title_en', 'title_ar', 'totalAssignments', 'completed', 'onTime', 'late', 'pastDue', 'notDueYet', 'completionRate', 'complianceRate'],
        rows.map((r) => [r.moduleId, T(r.title), r.title?.ar, r.totalAssignments, r.completed, r.onTime, r.late, r.pastDue, r.notDueYet, r.completionRate, r.complianceRate]),
      );
    } else {
      const rows = await this.nonCompliantData({ ...q, limit: 5000, includeLate: true } as any);
      csv = toCsv(
        ['riderId', 'name', 'phone', 'city', 'workerType', 'zone', 'moduleId', 'module_en', 'module_ar', 'compliance', 'assignedAt', 'dueAt', 'completedAt', 'daysOverdue', 'isBlocked'],
        rows.map((r) => [
          r.rider?.id, r.rider?.name, r.rider?.phone, r.rider?.city, r.rider?.workerType, r.rider?.zone,
          r.module.id, T(r.module.title), r.module.title?.ar, r.compliance, r.assignedAt, r.dueAt, r.completedAt, r.daysOverdue, r.isBlocked,
        ]),
      );
    }
    const name = `hs-lms-${type}-${riyadhDay(Date.now())}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(csv);
  }

  @Get('modules/:id')
  @ApiOperation({ summary: 'One module: assigned, compliance (onTime/late/complianceRate), video, PDF, quiz passed/failed, avg score' })
  async moduleStats(@Param('id') id: string) {
    const m = await this.modules.findById(id).lean();
    if (!m) throw new AppException('module_not_found', 404);
    const mid = new Types.ObjectId(id);
    const [c, progRows, quiz] = await Promise.all([
      this.compliance({ moduleId: mid }, new Date()),
      this.progressRows.aggregate([
        { $match: { moduleId: mid } },
        {
          $group: {
            _id: null,
            started: { $sum: 1 },
            videoCompleted: { $sum: { $cond: ['$videoCompleted', 1, 0] } },
            pdfViewed: { $sum: { $cond: ['$pdfViewed', 1, 0] } },
            quizAttempted: { $sum: { $cond: [{ $gt: ['$quizAttempts', 0] }, 1, 0] } },
            quizPassed: { $sum: { $cond: ['$quizPassed', 1, 0] } },
            totalAttempts: { $sum: { $ifNull: ['$quizAttempts', 0] } },
            avgBestScore: { $avg: '$bestScore' },
            avgVideoPercent: { $avg: { $ifNull: ['$videoPercent', 0] } },
          },
        },
      ]),
      this.quizzes.findOne({ moduleId: mid }).lean(),
    ]);
    const p = progRows[0] || {};
    return ok('dashboard', {
      module: { id: String(m._id), title: m.title, version: m.version },
      assigned: c.totalAssignments,
      completed: c.completed,
      pending: c.pending,
      overdue: c.overdue,
      completionRate: c.completionRate,
      onTime: c.onTime,
      late: c.late,
      pastDue: c.pastDue,
      notDueYet: c.notDueYet,
      complianceRate: c.complianceRate,
      started: p.started || 0,
      notStarted: Math.max(c.totalAssignments - (p.started || 0), 0),
      videoCompleted: p.videoCompleted || 0,
      avgVideoPercent: p.avgVideoPercent ? Math.round(p.avgVideoPercent) : 0,
      pdfViewed: p.pdfViewed || 0,
      quiz: quiz
        ? {
            totalQuestions: quiz.questions.length,
            passMark: quiz.passMark,
            attempted: p.quizAttempted || 0,
            passed: p.quizPassed || 0,
            failed: (p.quizAttempted || 0) - (p.quizPassed || 0),
            totalAttempts: p.totalAttempts || 0,
            avgBestScore: p.avgBestScore != null ? Math.round(p.avgBestScore * 10) / 10 : null,
            avgBestScorePercent:
              p.avgBestScore != null && quiz.questions.length ? Math.round((p.avgBestScore / quiz.questions.length) * 1000) / 10 : null,
            passRate: pct(p.quizPassed || 0, p.quizAttempted || 0),
          }
        : null,
    });
  }

  @Get('modules/:id/riders')
  @ApiOperation({ summary: 'One module, per rider: video %, PDF, quiz score, status, due date, on time / late, blocked' })
  async moduleRiders(@Param('id') id: string) {
    const m = await this.modules.findById(id).lean();
    if (!m) throw new AppException('module_not_found', 404);
    const [as, quiz] = await Promise.all([
      this.assignments.find({ moduleId: m._id }).sort({ status: 1, dueAt: 1 }).lean(),
      this.quizzes.findOne({ moduleId: m._id }).lean(),
    ]);
    const uids = as.map((a) => a.userId);
    const [users, progs] = await Promise.all([
      this.users.find({ _id: { $in: uids } }).select('name phone city workerType zone isBlocked').lean(),
      this.progressRows.find({ moduleId: m._id, userId: { $in: uids } }).lean(),
    ]);
    const uMap = new Map<string, any>(users.map((u) => [String(u._id), u]));
    const pMap = new Map<string, any>(progs.map((p) => [String(p.userId), p]));
    const now = Date.now();
    return ok(
      'dashboard',
      as.map((a) => {
        const u = uMap.get(String(a.userId));
        const due = new Date(a.dueAt).getTime();
        const compliance =
          a.status === 'completed'
            ? new Date(a.completedAt).getTime() <= due ? 'on_time' : 'late'
            : due < now ? 'overdue' : 'not_due_yet';
        return {
          rider: u
            ? { id: String(u._id), name: u.name, phone: u.phone, city: u.city, workerType: u.workerType || 'rider', zone: u.zone || null, isBlocked: u.isBlocked }
            : null,
          status: a.status,
          compliance,
          dueAt: a.dueAt,
          completedAt: a.completedAt,
          assignedByRule: !!a.ruleId,
          progress: this.progress.buildProgressView(m, quiz, pMap.get(String(a.userId)), a),
        };
      }),
    );
  }
}
