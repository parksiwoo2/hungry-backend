import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { User } from './entities/user.entity';
import { SessionService } from './session.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [AuthController, UsersController],
  providers: [
    UsersService,
    SessionService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class UsersModule {}
