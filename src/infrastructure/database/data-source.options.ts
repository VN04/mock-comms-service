import { DataSourceOptions } from 'typeorm';
import { AppConfig } from '../../config/configuration';
import { ApiKeyEntity } from './entities/api-key.entity';
import { CallEventEntity } from './entities/call-event.entity';
import { CallEntity } from './entities/call.entity';
import { InitialSchema1727700000000 } from './migrations/1727700000000-initial-schema';

export const ENTITIES = [ApiKeyEntity, CallEntity, CallEventEntity];
export const MIGRATIONS = [InitialSchema1727700000000];

/**
 * Shared by the Nest app (TypeOrmModule) and the standalone migration CLI,
 * so both always use identical settings. Schema changes go through
 * migrations only (`synchronize` is never enabled).
 */
export const buildDataSourceOptions = (
  db: AppConfig['database'],
): DataSourceOptions => ({
  type: 'mysql',
  host: db.host,
  port: db.port,
  username: db.user,
  password: db.password,
  database: db.name,
  entities: ENTITIES,
  migrations: MIGRATIONS,
  synchronize: false,
  timezone: 'Z',
  charset: 'utf8mb4',
  poolSize: db.poolSize,
});
