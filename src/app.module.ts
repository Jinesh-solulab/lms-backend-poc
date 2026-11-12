import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModulesController } from './admin-modules.controller';
import { AdminRidersController } from './admin-riders.controller';
import { AuthController, MeController } from './auth.controller';
import { BlockingService } from './blocking.service';
import { JwtAuthGuard } from './common/auth';
import { config } from './config';
import { DashboardController } from './dashboard.controller';
import { ProgressService } from './progress.service';
import { RiderController } from './rider.controller';
import { RoosterController } from './rooster.controller';
import { MetaController, RulesController } from './rules.controller';
import { RulesService } from './rules.service';
import { ALL_SCHEMAS } from './schemas';

@Module({
  imports: [
    MongooseModule.forRoot(config.mongoUri),
    MongooseModule.forFeature(ALL_SCHEMAS),
    JwtModule.register({ secret: config.jwtSecret, signOptions: { expiresIn: config.jwtExpiresIn as any } }),
    ScheduleModule.forRoot(),
  ],
  controllers: [AuthController, MeController, RiderController, AdminModulesController, AdminRidersController, DashboardController, RulesController, MetaController, RoosterController],
  providers: [JwtAuthGuard, ProgressService, BlockingService, RulesService],
})
export class AppModule {}
