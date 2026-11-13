import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Model } from 'mongoose';
import { BlockingService } from './blocking.service';
import { Auth, CurrentUser } from './common/auth';
import { AppException, ok } from './common/http';
import { ciEquals, normalizeSaudiPhone, publicUser, riderSearchOr } from './common/util';
import { BlockRiderDto, CreateRiderDto, RiderListQuery, UnblockRiderDto, UpdateRiderDto } from './dto';
import { canonicalCity, cleanText, workerTypeFilter } from './common/meta';
import { ProgressService } from './progress.service';
import { RulesService } from './rules.service';
import { DbModel, M } from './schemas';

@ApiTags('Admin - Riders & Blocking')
@Auth('admin')
@Controller('admin')
export class AdminRidersController {
  constructor(
    private blocking: BlockingService,
    private progress: ProgressService,
    private rules: RulesService,
    @InjectModel(M.User) private users: DbModel,
    @InjectModel(M.Assignment) private assignments: DbModel,
    @InjectModel(M.TrainingModule) private modules: DbModel,
    @InjectModel(M.Quiz) private quizzes: DbModel,
    @InjectModel(M.ModuleProgress) private progressRows: DbModel,
    @InjectModel(M.BlockLog) private logs: DbModel,
  ) {}

  private async getRider(id: string): Promise<any> {
    const u: any = await this.users.findOne({ _id: id, role: 'rider' }).lean();
    if (!u) throw new AppException('user_not_found', 404);
    return u;
  }

  @Get('riders')
  @ApiOperation({ summary: 'Rider list: filter by blocked/active, city, search. Includes assignment counts + block reason.' })
  async list(@Query() q: RiderListQuery, @CurrentUser() admin: any) {
    const filter: any = { role: 'rider' };
    if (q.status === 'blocked') filter.isBlocked = true;
    if (q.status === 'active') filter.isBlocked = false;
    if (q.city) filter.city = ciEquals(canonicalCity(q.city));
    if (q.workerType) filter.workerType = workerTypeFilter(q.workerType);
    if (q.search) filter.$or = riderSearchOr(q.search);
    const page = q.page || 1;
    const limit = q.limit || 20;
    const [rows, total] = await Promise.all([
      this.users.find(filter).sort({ isBlocked: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.users.countDocuments(filter),
    ]);
    const counts = await this.assignments.aggregate([
      { $match: { userId: { $in: rows.map((r) => r._id) } } },
      { $group: { _id: { u: '$userId', s: '$status' }, c: { $sum: 1 } } },
    ]);
    const cMap = new Map<string, any>();
    for (const c of counts) {
      const k = String(c._id.u);
      const o = cMap.get(k) || { total: 0, assigned: 0, completed: 0, overdue: 0 };
      o[c._id.s] = c.c;
      o.total += c.c;
      cMap.set(k, o);
    }
    return ok('riders_list', {
      items: rows.map((r) => ({
        ...publicUser(r, admin.language),
        assignments: cMap.get(String(r._id)) || { total: 0, assigned: 0, completed: 0, overdue: 0 },
      })),
      page,
      limit,
      total,
    });
  }

  @Post('riders')
  @ApiOperation({ summary: 'Create rider (phone, name, city, workerType, zone, language). Active assignment rules run right away.' })
  async create(@Body() dto: CreateRiderDto, @CurrentUser() admin: any) {
    const phone = normalizeSaudiPhone(dto.phone);
    if (!phone) throw new AppException('invalid_phone', 400);
    if (await this.users.exists({ phone })) throw new AppException('phone_exists', 409);
    const u = await this.users.create({
      phone,
      name: dto.name || '',
      city: canonicalCity(dto.city),
      workerType: dto.workerType || 'rider',
      zone: cleanText(dto.zone),
      language: dto.language || 'ar',
      role: 'rider',
    });
    const assignedByRules = await this.rules.applyForRider(u._id);
    return ok('rider_created', { ...publicUser(u.toObject(), admin.language), assignedByRules });
  }

  @Get('riders/:id')
  @ApiOperation({ summary: 'Rider details: profile, every assignment with progress, block history' })
  async details(@Param('id') id: string, @CurrentUser() admin: any) {
    const u = await this.getRider(id);
    const as = await this.assignments.find({ userId: u._id }).sort({ dueAt: 1 }).lean();
    const ids = as.map((a) => a.moduleId);
    const [mods, quizzes, progs, logs] = await Promise.all([
      this.modules.find({ _id: { $in: ids } }).lean(),
      this.quizzes.find({ moduleId: { $in: ids } }).lean(),
      this.progressRows.find({ userId: u._id, moduleId: { $in: ids } }).lean(),
      this.logs.find({ userId: u._id }).sort({ createdAt: -1 }).limit(50).lean(),
    ]);
    const mMap = new Map<string, any>(mods.map((m) => [String(m._id), m]));
    const qMap = new Map<string, any>(quizzes.map((q) => [String(q.moduleId), q]));
    const pMap = new Map<string, any>(progs.map((p) => [String(p.moduleId), p]));
    return ok('rider_details', {
      rider: publicUser(u, admin.language),
      assignments: as.map((a) => {
        const k = String(a.moduleId);
        const m = mMap.get(k);
        return {
          moduleId: k,
          title: m?.title || null,
          assignedAt: a.assignedAt,
          dueAt: a.dueAt,
          status: a.status,
          completedAt: a.completedAt,
          overdueAt: a.overdueAt,
          progress: this.progress.buildProgressView(m, qMap.get(k), pMap.get(k), a),
        };
      }),
      blockHistory: logs,
    });
  }

  @Get('riders/:id/modules/:moduleId/attempts')
  @ApiOperation({ summary: 'All quiz attempts of a rider on one module (newest first), with best / last score and isBest / isLatest flags' })
  async attempts(@Param('id') id: string, @Param('moduleId') moduleId: string) {
    const u = await this.getRider(id);
    if (!(await this.assignments.exists({ userId: u._id, moduleId }))) throw new AppException('not_assigned', 404);
    return ok('quiz_attempts', await this.progress.attemptHistory(u._id, moduleId));
  }

  @Patch('riders/:id')
  @ApiOperation({ summary: 'Edit rider (name, city, workerType, zone, language, active). City / type / zone change re-runs assignment rules.' })
  async update(@Param('id') id: string, @Body() dto: UpdateRiderDto, @CurrentUser() admin: any) {
    const before = await this.getRider(id);
    const $set: any = { ...dto };
    if (dto.city !== undefined) $set.city = canonicalCity(dto.city);
    if (dto.zone !== undefined) $set.zone = cleanText(dto.zone);
    const u = await this.users.findByIdAndUpdate(id, { $set }, { new: true }).lean();
    const changed =
      (u.city || null) !== (before.city || null) ||
      (u.workerType || 'rider') !== (before.workerType || 'rider') ||
      (u.zone || null) !== (before.zone || null) ||
      (u.isActive && !before.isActive);
    const assignedByRules = changed ? await this.rules.applyForRider(u._id) : 0;
    return ok('rider_updated', { ...publicUser(u, admin.language), assignedByRules });
  }

  @Post('riders/:id/block')
  @HttpCode(200)
  @ApiOperation({ summary: 'Manually block a rider with a reason' })
  async block(@Param('id') id: string, @Body() dto: BlockRiderDto, @CurrentUser() admin: any) {
    const u = await this.getRider(id);
    if (u.isBlocked) throw new AppException('already_blocked', 409);
    const now = new Date();
    const updated = await this.users
      .findByIdAndUpdate(
        u._id,
        { $set: { isBlocked: true, blockedAt: now, blockedBy: String(admin._id), blockReason: { kind: 'MANUAL', note: dto.reason } } },
        { new: true },
      )
      .lean();
    await this.logs.create({ userId: u._id, action: 'BLOCK', kind: 'MANUAL', reason: dto.reason, by: String(admin._id) });
    return ok('rider_blocked', publicUser(updated, admin.language));
  }

  @Post('riders/:id/unblock')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Unblock rider. Optional newDueAt gives overdue modules a new deadline (cron re-blocks only if that is missed).',
  })
  async unblock(@Param('id') id: string, @Body() dto: UnblockRiderDto, @CurrentUser() admin: any) {
    const u = await this.getRider(id);
    if (!u.isBlocked) throw new AppException('not_blocked', 409);
    let newDueAt: Date | null = null;
    if (dto.newDueAt) {
      newDueAt = new Date(dto.newDueAt);
      if (newDueAt.getTime() <= Date.now()) throw new AppException('due_date_invalid', 400);
    }

    const updated = await this.users
      .findByIdAndUpdate(u._id, { $set: { isBlocked: false, blockReason: null, blockedAt: null, blockedBy: null } }, { new: true })
      .lean();

    let rescheduled = 0;
    if (newDueAt) {
      const r = await this.assignments.updateMany(
        { userId: u._id, status: 'overdue' },
        { $set: { status: 'assigned', dueAt: newDueAt, overdueAt: null } },
      );
      rescheduled = r.modifiedCount;
    }

    await this.logs.create({
      userId: u._id,
      action: 'UNBLOCK',
      kind: u.blockReason?.kind || 'MANUAL',
      moduleId: u.blockReason?.moduleId || null,
      reason: u.blockReason?.kind === 'MODULE_OVERDUE' ? 'Unblocked by admin (was blocked for overdue module)' : 'Unblocked by admin',
      note: dto.note,
      by: String(admin._id),
      newDueAt,
    });
    return ok('rider_unblocked', { rider: publicUser(updated, admin.language), rescheduledAssignments: rescheduled });
  }

  @Get('block-logs')
  @ApiOperation({
    summary: 'Block / unblock history (latest first). Actions: BLOCK, OVERDUE, UNBLOCK (admin), AUTO_UNBLOCK (rider completed), STILL_BLOCKED',
  })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'action', required: false, description: 'Comma list, e.g. AUTO_UNBLOCK or BLOCK,UNBLOCK' })
  @ApiQuery({ name: 'by', required: false, description: "'SYSTEM' (cron / auto-unblock) or an admin id" })
  @ApiQuery({ name: 'limit', required: false })
  async blockLogs(
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('by') by?: string,
    @Query('limit') limit?: string,
  ) {
    const filter: any = {};
    if (userId) filter.userId = userId;
    if (action) filter.action = { $in: action.split(',').map((a) => a.trim().toUpperCase()).filter(Boolean) };
    if (by) filter.by = by;
    const rows = await this.logs.find(filter).sort({ createdAt: -1 }).limit(Math.min(parseInt(limit || '100', 10) || 100, 500)).lean();
    const [users, mods] = await Promise.all([
      this.users.find({ _id: { $in: rows.map((r) => r.userId) } }).select('name phone city').lean(),
      this.modules.find({ _id: { $in: rows.map((r) => r.moduleId).filter(Boolean) } }).select('title').lean(),
    ]);
    const uMap = new Map<string, any>(users.map((u) => [String(u._id), u]));
    const mMap = new Map<string, any>(mods.map((m) => [String(m._id), m.title]));
    return ok(
      'block_logs',
      rows.map((r) => ({
        ...r,
        rider: uMap.get(String(r.userId)) || null,
        moduleTitle: r.moduleId ? mMap.get(String(r.moduleId)) || null : null,
      })),
    );
  }

  @Post('jobs/deadline-check')
  @HttpCode(200)
  @ApiOperation({ summary: 'DEMO: run the auto-block deadline check now (cron also runs it every minute)' })
  async runNow() {
    const r: any = await this.blocking.runDeadlineCheck();
    return ok('deadline_check_done', r, { blocked: r.blocked ?? 0 });
  }
}
