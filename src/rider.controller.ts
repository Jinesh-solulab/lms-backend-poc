import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Auth, CurrentUser } from './common/auth';
import { AppException, ok } from './common/http';
import { isLang } from './common/messages';
import { SyncDto } from './dto';
import { ProgressService } from './progress.service';

@ApiTags('Rider')
@Auth('rider')
@Controller('rider')
export class RiderController {
  constructor(private progress: ProgressService) {}

  @Get('modules')
  @ApiOperation({ summary: 'My assigned modules (localized) with due date, status and progress' })
  async modules(@CurrentUser() user: any) {
    return ok('modules_list', await this.progress.riderModules(user, user.language));
  }

  @Get('modules/:id/package')
  @ApiOperation({ summary: 'Offline package: video + PDF URLs, quiz (no answers), version. Store it on the phone.' })
  @ApiQuery({ name: 'lang', required: false, enum: ['ar', 'en', 'ur', 'all'], description: 'Default = my language. "all" = every language.' })
  async package(@Param('id') id: string, @Query('lang') lang: string, @CurrentUser() user: any) {
    const l = isLang(lang) || lang === 'all' ? lang : user.language;
    const r = await this.progress.modulePackage(user, id, l);
    if ('error' in r) throw new AppException(r.error, r.error === 'not_assigned' ? 403 : 404);
    return ok('package', r.data);
  }

  @Get('modules/:id/progress')
  @ApiOperation({ summary: 'My progress on one module' })
  async moduleProgress(@Param('id') id: string, @CurrentUser() user: any) {
    const r = await this.progress.moduleProgress(user, id);
    if ('error' in r) throw new AppException(r.error, r.error === 'not_assigned' ? 403 : 404);
    return ok('progress', r.data);
  }

  @Get('modules/:id/attempts')
  @ApiOperation({
    summary: 'My quiz attempts on one module (newest first) with best and last score',
    description: 'Show the certificate with bestScore (highest), not lastScore. Each item has isBest / isLatest flags.',
  })
  async attempts(@Param('id') id: string, @CurrentUser() user: any) {
    const r = await this.progress.moduleProgress(user, id);
    if ('error' in r) throw new AppException(r.error, r.error === 'not_assigned' ? 403 : 404);
    return ok('quiz_attempts', await this.progress.attemptHistory(user._id, id));
  }

  @Post('sync')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Offline + online sync (batch). Same eventId sent again = ignored (no double counting).',
    description:
      'Event types: VIDEO_PROGRESS {percent}, PDF_VIEWED {}, QUIZ_SUBMITTED {answers:[{questionId, selectedIndex}]}. ' +
      'Quiz is graded on the server; result comes back in quizResults.',
  })
  async sync(@Body() dto: SyncDto, @CurrentUser() user: any) {
    const r = await this.progress.sync(user, dto.events);
    return ok(r.account.autoUnblocked ? 'sync_done_unblocked' : 'sync_done', r, { accepted: r.accepted, duplicates: r.duplicates });
  }
}
