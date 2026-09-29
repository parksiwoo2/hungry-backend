import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrecedentModule } from './precedent/precedent.module';
import { EnsurePrecedentSchema20260816000000 } from './migrations/20260816000000-ensure-precedent-schema';
import { CreatePrecedentAnalyses20260816010000 } from './migrations/20260816010000-create-precedent-analyses';
import { CreateUsers20260922000000 } from './migrations/20260922000000-create-users';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: Number(configService.get<string>('DB_PORT') ?? 5432),
        username: configService.get<string>('DB_USERNAME', 'postgres'),
        password: configService.getOrThrow<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_NAME', 'hungry'),
        autoLoadEntities: true,
        synchronize: false,
        migrations: [
          EnsurePrecedentSchema20260816000000,
          CreatePrecedentAnalyses20260816010000,
          CreateUsers20260922000000,
        ],
        migrationsRun: true,
      }),
    }),
    PrecedentModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
