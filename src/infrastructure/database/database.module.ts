import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../../config/configuration';
import { buildDataSourceOptions, ENTITIES } from './data-source.options';
import { ApiKeyRepository } from './repositories/api-key.repository';
import { CallEventRepository } from './repositories/call-event.repository';
import { CallRepository } from './repositories/call.repository';
import { TransactionRunner } from './transaction.runner';

const REPOSITORIES = [
  ApiKeyRepository,
  CallRepository,
  CallEventRepository,
  TransactionRunner,
];

/**
 * MySQL connection + repositories. Feature modules inject the repositories;
 * nothing outside this folder imports TypeORM, so the ORM can be swapped here.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        buildDataSourceOptions(config.get('database', { infer: true })),
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  providers: REPOSITORIES,
  exports: REPOSITORIES,
})
export class DatabaseModule {}
