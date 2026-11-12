import { Controller, Get, Param } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Model, Types } from 'mongoose';
import { Auth } from './common/auth';
import { AppException, ok } from './common/http';
import { ProgressService } from './progress.service';
import { DbModel, M } from './schemas';

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const statusSum = (s: string) => ({ $sum: { $cond: [{ $eq: ['$status', s] }, 1, 0] } });

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

  @Get('summary')
  @ApiOperation({ summary: 'Top numbers: riders, blocked, assignments, completed, overdue, completion %' })
  async summary() {
    const [totalRiders, blockedRiders, totalModules, byStatus, inProgress] = await Promise.all([
      this.users.countDocuments({ role: 'rider' }),
      this.users.countDocuments({ role: 'rider', isBlocked: true }),
      this.modules.countDocuments({ isActive: true }),
      this.assignments.aggregate([{ $group: { _id: '$status', c: { $sum: 1 } } }]),
      this.progressRows.countDocuments({
        completed: { $ne: true },
        $or: [{ videoPercent: { $gt: 0 } }, { pdfViewed: true }, { quizAttempts: { $gt: 0 } }],
      }),
    ]);
    const s: Record<string, number> = { assigned: 0, completed: 0, overdue: 0 };
    for (const r of byStatus) s[r._id] = r.c;
    const totalAssignments = s.assigned + s.completed + s.overdue;
    return ok('dashboard', {
      totalRiders,
      activeRiders: totalRiders - blockedRiders,
      blockedRiders,
      totalModules,
      totalAssignments,
      completed: s.completed,
      pending: s.assigned,
      overdue: s.overdue,
      inProgress,
      notStarted: Math.max(s.assigned + s.overdue - inProgress, 0),
      completionRate: pct(s.completed, totalAssignments),
      overdueRate: pct(s.overdue, totalAssignments),
      generatedAt: new Date(),
    });
  }

  @Get('by-city')
  @ApiOperation({ summary: 'Completion / overdue / blocked numbers per city' })
  async byCity() {
    const [rows, riders] = await Promise.all([
      this.assignments.aggregate([
        { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'u' } },
        { $unwind: '$u' },
        {
          $group: {
            _id: { $ifNull: ['$u.city', 'Unknown'] },
            totalAssignments: { $sum: 1 },
            completed: statusSum('completed'),
            pending: statusSum('assigned'),
            overdue: statusSum('overdue'),
          },
        },
      ]),
      this.users.aggregate([
        { $match: { role: 'rider' } },
        {
          $group: {
            _id: { $ifNull: ['$city', 'Unknown'] },
            riders: { $sum: 1 },
            blocked: { $sum: { $cond: ['$isBlocked', 1, 0] } },
          },
        },
      ]),
    ]);
    const map = new Map<string, any>();
    for (const r of riders) map.set(r._id, { city: r._id, riders: r.riders, blockedRiders: r.blocked, totalAssignments: 0, completed: 0, pending: 0, overdue: 0 });
    for (const r of rows) {
      const o = map.get(r._id) || { city: r._id, riders: 0, blockedRiders: 0 };
      Object.assign(o, { totalAssignments: r.totalAssignments, completed: r.completed, pending: r.pending, overdue: r.overdue });
      map.set(r._id, o);
    }
    const items = [...map.values()]
      .map((o) => ({ ...o, completionRate: pct(o.completed, o.totalAssignments) }))
      .sort((a, b) => b.riders - a.riders);
    return ok('dashboard', items);
  }

  @Get('modules/:id')
  @ApiOperation({ summary: 'One module: assigned, video completed, PDF viewed, quiz passed/failed, avg score' })
  async moduleStats(@Param('id') id: string) {
    const m = await this.modules.findById(id).lean();
    if (!m) throw new AppException('module_not_found', 404);
    const mid = new Types.ObjectId(id);
    const [statusRows, progRows, quiz] = await Promise.all([
      this.assignments.aggregate([{ $match: { moduleId: mid } }, { $group: { _id: '$status', c: { $sum: 1 } } }]),
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
    const s: Record<string, number> = { assigned: 0, completed: 0, overdue: 0 };
    for (const r of statusRows) s[r._id] = r.c;
    const total = s.assigned + s.completed + s.overdue;
    const p = progRows[0] || {};
    return ok('dashboard', {
      module: { id: String(m._id), title: m.title, version: m.version },
      assigned: total,
      completed: s.completed,
      pending: s.assigned,
      overdue: s.overdue,
      completionRate: pct(s.completed, total),
      started: p.started || 0,
      notStarted: Math.max(total - (p.started || 0), 0),
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
            passRate: pct(p.quizPassed || 0, p.quizAttempted || 0),
          }
        : null,
    });
  }

  @Get('modules/:id/riders')
  @ApiOperation({ summary: 'One module, per rider: video %, PDF, quiz score, status, due date, blocked' })
  async moduleRiders(@Param('id') id: string) {
    const m = await this.modules.findById(id).lean();
    if (!m) throw new AppException('module_not_found', 404);
    const [as, quiz] = await Promise.all([
      this.assignments.find({ moduleId: m._id }).sort({ status: 1, dueAt: 1 }).lean(),
      this.quizzes.findOne({ moduleId: m._id }).lean(),
    ]);
    const uids = as.map((a) => a.userId);
    const [users, progs] = await Promise.all([
      this.users.find({ _id: { $in: uids } }).select('name phone city isBlocked').lean(),
      this.progressRows.find({ moduleId: m._id, userId: { $in: uids } }).lean(),
    ]);
    const uMap = new Map<string, any>(users.map((u) => [String(u._id), u]));
    const pMap = new Map<string, any>(progs.map((p) => [String(p.userId), p]));
    return ok(
      'dashboard',
      as.map((a) => {
        const u = uMap.get(String(a.userId));
        return {
          rider: u ? { id: String(u._id), name: u.name, phone: u.phone, city: u.city, isBlocked: u.isBlocked } : null,
          status: a.status,
          dueAt: a.dueAt,
          completedAt: a.completedAt,
          progress: this.progress.buildProgressView(m, quiz, pMap.get(String(a.userId)), a),
        };
      }),
    );
  }
}
