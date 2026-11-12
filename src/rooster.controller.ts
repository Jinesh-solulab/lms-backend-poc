import { Controller, Get, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth, CurrentUser } from './common/auth';
import { ok } from './common/http';
import { canonicalCity, workerTypeFilter } from './common/meta';
import { ciEquals, publicUser, riderSearchOr } from './common/util';
import { RoosterRiderQuery } from './dto';
import { DbModel, M } from './schemas';

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/**
 * "Rooster" admin screen (POC stand-in for the dispatch integration): riders who have not finished their
 * training, how far they are, and whether dispatch would be allowed (not blocked) or on hold (blocked).
 * Block / unblock reuse /admin/riders/:id/block|unblock; the "View" button reuses GET /admin/riders/:id.
 * Riders with no assignments are left out (nothing to complete).
 */
@ApiTags('Admin - Rooster (training compliance)')
@Auth('admin')
@Controller('admin/rooster')
export class RoosterController {
  constructor(@InjectModel(M.Assignment) private assignments: DbModel) {}

  @Get('riders')
  @ApiOperation({
    summary: 'Riders with training counts + completion %, blocked first then least complete. Plus overall summary.',
    description:
      'Filters: training=incomplete (default) | complete | all, status=blocked|active, city, workerType, search (name/phone), page, limit. ' +
      'completionPercent = completed modules / assigned modules. dispatch = ON_HOLD when blocked, else ALLOWED. ' +
      'summary ignores the training filter and pagination.',
  })
  async riders(@Query() q: RoosterRiderQuery, @CurrentUser() admin: any) {
    const now = new Date();
    const page = q.page || 1;
    const limit = q.limit || 20;
    const training = q.training || 'incomplete';

    const userMatch: any = { 'u.role': 'rider' };
    if (q.status === 'blocked') userMatch['u.isBlocked'] = true;
    if (q.status === 'active') userMatch['u.isBlocked'] = { $ne: true };
    if (q.city) userMatch['u.city'] = ciEquals(canonicalCity(q.city));
    if (q.workerType) userMatch['u.workerType'] = workerTypeFilter(q.workerType);
    if (q.search) userMatch.$or = riderSearchOr(q.search, 'u.');
    const trainingMatch = training === 'incomplete' ? { pending: { $gt: 0 } } : training === 'complete' ? { pending: 0 } : {};

    const [r] = await this.assignments.aggregate([
      {
        $group: {
          _id: '$userId',
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'completed'] }, { $lt: ['$dueAt', now] }] }, 1, 0] } },
          nextDueAt: { $min: { $cond: [{ $ne: ['$status', 'completed'] }, '$dueAt', null] } },
        },
      },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
      { $unwind: '$u' },
      { $match: userMatch },
      {
        $addFields: {
          pending: { $subtract: ['$total', '$completed'] },
          completionPercent: { $round: [{ $multiply: [{ $divide: ['$completed', '$total'] }, 100] }, 0] },
          blockedSort: { $cond: ['$u.isBlocked', 1, 0] },
        },
      },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                riders: { $sum: 1 },
                fullyTrained: { $sum: { $cond: [{ $eq: ['$pending', 0] }, 1, 0] } },
                blocked: { $sum: '$blockedSort' },
                withOverdue: { $sum: { $cond: [{ $gt: ['$overdue', 0] }, 1, 0] } },
                assignments: { $sum: '$total' },
                completedAssignments: { $sum: '$completed' },
              },
            },
          ],
          items: [
            { $match: trainingMatch },
            { $sort: { blockedSort: -1, completionPercent: 1, overdue: -1, nextDueAt: 1, _id: 1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
          ],
          total: [{ $match: trainingMatch }, { $count: 'c' }],
        },
      },
    ]);

    const s = r?.summary?.[0] || { riders: 0, fullyTrained: 0, blocked: 0, withOverdue: 0, assignments: 0, completedAssignments: 0 };
    return ok('riders_list', {
      summary: {
        ridersWithTraining: s.riders,
        fullyTrained: s.fullyTrained,
        notFullyTrained: s.riders - s.fullyTrained,
        fullyTrainedPercent: pct(s.fullyTrained, s.riders),
        withOverdue: s.withOverdue,
        blocked: s.blocked,
        totalAssignments: s.assignments,
        completedAssignments: s.completedAssignments,
        completionPercent: pct(s.completedAssignments, s.assignments),
      },
      items: (r?.items || []).map((x: any) => ({
        ...publicUser(x.u, admin.language),
        dispatch: x.u.isBlocked ? 'ON_HOLD' : 'ALLOWED',
        training: {
          total: x.total,
          completed: x.completed,
          pending: x.pending,
          overdue: x.overdue,
          completionPercent: x.completionPercent,
          nextDueAt: x.nextDueAt || null,
        },
      })),
      training,
      page,
      limit,
      total: r?.total?.[0]?.c || 0,
    });
  }
}
