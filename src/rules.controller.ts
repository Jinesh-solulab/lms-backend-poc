import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth, CurrentUser } from './common/auth';
import { AppException, ok } from './common/http';
import { riderFilter, SAUDI_CITIES, WORKER_TYPE_LIST } from './common/meta';
import { CreateRuleDto, RuleListQuery, RulePreviewDto, UpdateRuleDto } from './dto';
import { RulesService } from './rules.service';
import { DbModel, M } from './schemas';

@ApiTags('Admin - Assignment rules')
@Auth('admin')
@Controller('admin/rules')
export class RulesController {
  constructor(
    private rulesSvc: RulesService,
    @InjectModel(M.AssignmentRule) private rules: DbModel,
    @InjectModel(M.TrainingModule) private modules: DbModel,
    @InjectModel(M.User) private users: DbModel,
  ) {}

  private async view(r: any, module?: any) {
    const m = module || (await this.modules.findById(r.moduleId).select('title isActive').lean());
    return {
      id: String(r._id),
      name: r.name,
      moduleId: String(r.moduleId),
      module: m ? { id: String(m._id), title: m.title, isActive: m.isActive } : null,
      criteria: { city: r.criteria?.city || null, workerType: r.criteria?.workerType || null, zone: r.criteria?.zone || null },
      deadlineDays: r.deadlineDays,
      deadlineMinutes: r.deadlineMinutes || null,
      isActive: r.isActive,
      assignedCount: r.assignedCount || 0,
      lastRunAt: r.lastRunAt || null,
      matchedNow: await this.users.countDocuments(riderFilter(r.criteria || {})),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private async getRule(id: string) {
    const r = await this.rules.findById(id).lean();
    if (!r) throw new AppException('rule_not_found', 404);
    return r;
  }

  @Get()
  @ApiOperation({ summary: 'List rules (optional ?moduleId). Each has assignedCount, lastRunAt and matchedNow.' })
  async list(@Query() q: RuleListQuery) {
    const filter: any = q.moduleId ? { moduleId: q.moduleId } : {};
    const rows = await this.rules.find(filter).sort({ createdAt: -1 }).lean();
    const mods = await this.modules.find({ _id: { $in: rows.map((r) => r.moduleId) } }).select('title isActive').lean();
    const mMap = new Map<string, any>(mods.map((m) => [String(m._id), m]));
    return ok('rules_list', await Promise.all(rows.map((r) => this.view(r, mMap.get(String(r.moduleId)) || null))));
  }

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({ summary: '"N riders match" before saving. Returns { matched, alreadyAssigned?, willAssign?, sample }' })
  async preview(@Body() dto: RulePreviewDto) {
    const r = await this.rulesSvc.preview(dto.criteria || {}, dto.moduleId);
    return ok('rules_preview', r, { matched: r.matched });
  }

  @Post()
  @ApiOperation({ summary: 'Create a rule. If active, it assigns to all matching riders now (assignedNow).' })
  async create(@Body() dto: CreateRuleDto, @CurrentUser() admin: any) {
    const m = await this.modules.findById(dto.moduleId).select('title isActive deadlineDays').lean();
    if (!m) throw new AppException('module_not_found', 404);
    const created = await this.rules.create({
      name: dto.name.trim(),
      moduleId: m._id,
      criteria: this.rulesSvc.normalizeCriteria(dto.criteria || {}),
      deadlineDays: dto.deadlineDays || m.deadlineDays || 7,
      deadlineMinutes: dto.deadlineMinutes || null,
      isActive: dto.isActive ?? true,
      createdBy: admin._id,
    });
    const assignedNow = created.isActive ? await this.rulesSvc.applyRule(created.toObject()) : 0;
    const fresh = await this.rules.findById(created._id).lean();
    return ok('rule_created', { ...(await this.view(fresh, m)), assignedNow }, { count: assignedNow });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit or switch on/off. Re-applies when the rule is (still) active after the change.' })
  async update(@Param('id') id: string, @Body() dto: UpdateRuleDto) {
    await this.getRule(id);
    const $set: any = {};
    if (dto.name !== undefined) $set.name = dto.name.trim();
    if (dto.criteria !== undefined) $set.criteria = this.rulesSvc.normalizeCriteria(dto.criteria || {});
    if (dto.deadlineDays !== undefined) $set.deadlineDays = dto.deadlineDays;
    if (dto.deadlineMinutes !== undefined) $set.deadlineMinutes = dto.deadlineMinutes || null;
    if (dto.isActive !== undefined) $set.isActive = dto.isActive;
    const updated = await this.rules.findByIdAndUpdate(id, { $set }, { new: true }).lean();
    const assignedNow = updated.isActive ? await this.rulesSvc.applyRule(updated) : 0;
    const fresh = await this.rules.findById(id).lean();
    return ok('rule_updated', { ...(await this.view(fresh)), assignedNow });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a rule. Assignments it already created stay.' })
  async remove(@Param('id') id: string) {
    await this.getRule(id);
    await this.rules.deleteOne({ _id: id });
    return ok('rule_deleted', { id });
  }

  @Post(':id/apply')
  @HttpCode(200)
  @ApiOperation({ summary: 'DEMO: run this rule now (the 5-minute sweep and rider hooks also run it)' })
  async apply(@Param('id') id: string) {
    const r = await this.getRule(id);
    if (!r.isActive) return ok('rule_applied', { ...(await this.view(r)), assignedNow: 0 }, { count: 0 });
    const assignedNow = await this.rulesSvc.applyRule(r);
    return ok('rule_applied', { ...(await this.view(await this.getRule(id))), assignedNow }, { count: assignedNow });
  }
}

/** Dropdown data. Public: the rider app needs the city list at registration, before login. */
@ApiTags('Meta (dropdowns)')
@Controller('meta')
export class MetaController {
  constructor(@InjectModel(M.User) private users: DbModel) {}

  @Get('cities')
  @ApiOperation({ summary: 'Known Saudi cities (value = English name) + any other city already on a rider' })
  async cities() {
    const known = SAUDI_CITIES.map((c) => ({ value: c.en, en: c.en, ar: c.ar, ur: c.ur }));
    const used: string[] = (await this.users.distinct('city', { role: 'rider', city: { $nin: [null, ''] } })) || [];
    const knownSet = new Set(known.map((k) => k.value.toLowerCase()));
    const extra = used.filter((c) => !knownSet.has(String(c).toLowerCase())).map((c) => ({ value: c, en: c, ar: c, ur: c }));
    return ok('meta', [...known, ...extra]);
  }

  @Get('worker-types')
  @ApiOperation({ summary: 'rider | picker | bpo with ar/en/ur labels' })
  workerTypes() {
    return ok('meta', WORKER_TYPE_LIST);
  }

  @Get('zones')
  @ApiOperation({ summary: 'Zones already used on riders' })
  async zones() {
    const z: string[] = await this.users.distinct('zone', { role: 'rider', zone: { $nin: [null, ''] } });
    return ok('meta', z.sort());
  }
}
