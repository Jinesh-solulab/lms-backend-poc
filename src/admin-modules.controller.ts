import { Body, Controller, Get, Param, Patch, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Model, Types } from 'mongoose';
import { Auth, CurrentUser } from './common/auth';
import { AppException, ok } from './common/http';
import { FileStorage } from './common/storage';
import { uploadOptions, uploadRelPath } from './common/util';
import { riderFilter } from './common/meta';
import { AssignModuleDto, CreateModuleDto, SaveQuizDto, UpdateModuleDto } from './dto';
import { ProgressService } from './progress.service';
import { DbModel, M } from './schemas';

const FILE_BODY = { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } };

@ApiTags('Admin - Modules')
@Auth('admin')
@Controller('admin/modules')
export class AdminModulesController {
  constructor(
    private progress: ProgressService,
    private files: FileStorage,
    @InjectModel(M.TrainingModule) private modules: DbModel,
    @InjectModel(M.Quiz) private quizzes: DbModel,
    @InjectModel(M.Assignment) private assignments: DbModel,
    @InjectModel(M.User) private users: DbModel,
  ) {}

  private async getModule(id: string): Promise<any> {
    const m: any = await this.modules.findById(id).lean();
    if (!m) throw new AppException('module_not_found', 404);
    return m;
  }

  private async counts(ids: any[]) {
    const rows = await this.assignments.aggregate([
      { $match: { moduleId: { $in: ids } } },
      { $group: { _id: { m: '$moduleId', s: '$status' }, c: { $sum: 1 } } },
    ]);
    const out = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const k = String(r._id.m);
      const o = out.get(k) || { total: 0, assigned: 0, completed: 0, overdue: 0 };
      o[r._id.s] = r.c;
      o.total += r.c;
      out.set(k, o);
    }
    return out;
  }

  @Post()
  @ApiOperation({ summary: 'Create module (title/description in Arabic + English, deadline days)' })
  async create(@Body() dto: CreateModuleDto, @CurrentUser() admin: any) {
    const m = await this.modules.create({ ...dto, createdBy: admin._id });
    return ok('module_created', this.progress.adminModuleView(m.toObject(), null));
  }

  @Get()
  @ApiOperation({ summary: 'List modules with quiz info + assignment counts' })
  async list() {
    const mods = await this.modules.find().sort({ createdAt: -1 }).lean();
    const ids = mods.map((m) => m._id);
    const [quizzes, counts] = await Promise.all([this.quizzes.find({ moduleId: { $in: ids } }).lean(), this.counts(ids)]);
    const qMap = new Map<string, any>(quizzes.map((q) => [String(q.moduleId), q]));
    return ok(
      'modules_list',
      mods.map((m) =>
        this.progress.adminModuleView(m, qMap.get(String(m._id)) || null, counts.get(String(m._id)) || { total: 0, assigned: 0, completed: 0, overdue: 0 }),
      ),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Module details incl. quiz with correct answers' })
  async get(@Param('id') id: string) {
    const m = await this.getModule(id);
    const [q, counts] = await Promise.all([this.quizzes.findOne({ moduleId: m._id }).lean(), this.counts([m._id])]);
    return ok('module_details', this.progress.adminModuleView(m, q, counts.get(String(m._id)) || { total: 0, assigned: 0, completed: 0, overdue: 0 }));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit module (title, description, deadline days, video complete %, active)' })
  async update(@Param('id') id: string, @Body() dto: UpdateModuleDto) {
    await this.getModule(id);
    const contentChanged = dto.title || dto.description;
    const m = await this.modules
      .findByIdAndUpdate(id, { $set: dto, ...(contentChanged ? { $inc: { version: 1 } } : {}) }, { new: true })
      .lean();
    const q = await this.quizzes.findOne({ moduleId: m._id }).lean();
    return ok('module_updated', this.progress.adminModuleView(m, q));
  }

  @Post(':id/video')
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @ApiOperation({ summary: 'Upload / replace module video (form field "file"). Stored in MongoDB GridFS, served at /uploads/... with Range support.' })
  @UseInterceptors(FileInterceptor('file', uploadOptions('video')))
  async uploadVideo(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.saveFile(id, 'video', file);
  }

  @Post(':id/pdf')
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @ApiOperation({ summary: 'Upload / replace module PDF (form field "file")' })
  @UseInterceptors(FileInterceptor('file', uploadOptions('pdf')))
  async uploadPdf(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.saveFile(id, 'pdf', file);
  }

  private async saveFile(id: string, kind: 'video' | 'pdf', file: Express.Multer.File) {
    if (!file) throw new AppException('file_required', 400);
    const rel = uploadRelPath(kind, file.filename);
    const m = Types.ObjectId.isValid(id) ? await this.modules.findById(id).lean() : null;
    if (!m) {
      this.files.discard(file);
      throw new AppException('module_not_found', 404);
    }
    await this.files.save(file, rel); // into MongoDB GridFS, survives redeploys
    const updated = await this.modules
      .findByIdAndUpdate(
        id,
        {
          $set: {
            [kind]: { path: rel, originalName: file.originalname, sizeBytes: file.size, mimeType: file.mimetype, uploadedAt: new Date() },
          },
          $inc: { version: 1 },
        },
        { new: true },
      )
      .lean();
    await this.files.remove(m[kind]?.path); // delete the replaced file
    const q = await this.quizzes.findOne({ moduleId: updated._id }).lean();
    return ok(kind === 'video' ? 'video_uploaded' : 'pdf_uploaded', this.progress.adminModuleView(updated, q));
  }

  @Put(':id/quiz')
  @ApiOperation({ summary: 'Create / replace quiz. passMark = correct answers needed (e.g. 3 of 5).' })
  async saveQuiz(@Param('id') id: string, @Body() dto: SaveQuizDto) {
    const m = await this.getModule(id);
    if (dto.passMark > dto.questions.length) throw new AppException('pass_mark_invalid', 400);
    for (const q of dto.questions) {
      if (q.correctIndex >= q.options.length) throw new AppException('quiz_invalid', 400);
    }
    const questions = dto.questions.map((q) => ({
      ...(q.id ? { _id: new Types.ObjectId(q.id) } : {}),
      text: q.text,
      options: q.options,
      correctIndex: q.correctIndex,
    }));
    const quiz = await this.quizzes
      .findOneAndUpdate({ moduleId: m._id }, { $set: { passMark: dto.passMark, questions } }, { upsert: true, new: true })
      .lean();
    const updated = await this.modules.findByIdAndUpdate(m._id, { $inc: { version: 1 } }, { new: true }).lean();
    return ok('quiz_saved', this.progress.adminModuleView(updated, quiz));
  }

  @Post(':id/assign')
  @ApiOperation({
    summary:
      'One-off assign to riders: by ids and/or city / workerType / zone (all empty = every active rider). ' +
      'Due = dueAt | dueInMinutes | deadlineDays | module deadlineDays | 7 days. Only riders matching today; use /admin/rules for future riders.',
  })
  async assign(@Param('id') id: string, @Body() dto: AssignModuleDto, @CurrentUser() admin: any) {
    const m = await this.getModule(id);
    const now = Date.now();
    // Due date priority: dueAt > dueInMinutes > deadlineDays (body) > module deadlineDays > 7
    const dueAt = dto.dueAt
      ? new Date(dto.dueAt)
      : dto.dueInMinutes
        ? new Date(now + dto.dueInMinutes * 60_000)
        : new Date(now + (dto.deadlineDays || m.deadlineDays || 7) * 86_400_000);
    if (dueAt.getTime() <= now) throw new AppException('due_date_invalid', 400);

    // Same matching as assignment rules (city canonical + case-insensitive, workerType, zone)
    const filter: any = riderFilter({ city: dto.city, workerType: dto.workerType, zone: dto.zone });
    if (dto.userIds?.length) filter._id = { $in: dto.userIds };
    const riders = await this.users.find(filter).select('_id').lean();

    let newlyAssigned = 0;
    if (riders.length) {
      const res = await this.assignments.bulkWrite(
        riders.map((r) => ({
          updateOne: {
            filter: { userId: r._id, moduleId: m._id },
            update: {
              $setOnInsert: { userId: r._id, moduleId: m._id, assignedAt: new Date(), dueAt, status: 'assigned', assignedBy: admin._id },
            },
            upsert: true,
          },
        })),
      );
      newlyAssigned = res.upsertedCount || 0;
    }

    let updatedExisting = 0;
    if (dto.updateExisting && riders.length) {
      const r = await this.assignments.updateMany(
        { moduleId: m._id, userId: { $in: riders.map((x) => x._id) }, status: { $ne: 'completed' } },
        { $set: { dueAt, status: 'assigned', overdueAt: null } },
      );
      updatedExisting = r.modifiedCount;
    }

    return ok(
      'assigned',
      { matchedRiders: riders.length, newlyAssigned, alreadyAssigned: riders.length - newlyAssigned, updatedExisting, dueAt },
      { count: newlyAssigned },
    );
  }
}
