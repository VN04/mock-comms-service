import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildConfig } from '../../config/configuration';
import { validateEnv } from '../../config/env.validation';
import { buildDataSourceOptions } from './data-source.options';

/** DataSource for the TypeORM CLI (`pnpm migration:*`) and the bootstrap script. */
export default new DataSource(
  buildDataSourceOptions(buildConfig(validateEnv(process.env)).database),
);
