import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  apiKeyDisplayPrefix,
  generateApiKey,
  hashApiKey,
} from '../../../common/auth/api-key-crypto';
import { ApiKeyRole } from '../../../common/auth/api-key-context';
import dataSource from '../data-source';
import { ApiKeyEntity } from '../entities/api-key.entity';

/**
 * One-shot DB bootstrap (run by the `migrate` service in Docker Compose):
 *   1. runs pending migrations,
 *   2. seeds an admin and a client API key if they don't exist yet.
 *
 * Seed keys come from SEED_ADMIN_API_KEY / SEED_CLIENT_API_KEY when set
 * (handy for local dev), otherwise random keys are generated and printed ONCE.
 */
async function seedKey(
  ds: DataSource,
  name: string,
  role: ApiKeyRole,
  providedKey?: string,
): Promise<void> {
  const repo = ds.getRepository(ApiKeyEntity);
  if (await repo.findOneBy({ name })) {
    console.log(`[seed] API key "${name}" already exists — skipping`);
    return;
  }
  const rawKey = providedKey ?? generateApiKey();
  await repo.save(
    repo.create({
      id: randomUUID(),
      name,
      role,
      keyHash: hashApiKey(rawKey),
      keyPrefix: apiKeyDisplayPrefix(rawKey),
    }),
  );
  console.log(
    `[seed] Created ${role} API key "${name}": ${providedKey ? '(from env)' : rawKey}`,
  );
}

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    const applied = await dataSource.runMigrations({ transaction: 'each' });
    console.log(`[migrate] Applied ${applied.length} migration(s)`);
    await seedKey(
      dataSource,
      'seed-admin',
      ApiKeyRole.ADMIN,
      process.env.SEED_ADMIN_API_KEY,
    );
    await seedKey(
      dataSource,
      'seed-client',
      ApiKeyRole.CLIENT,
      process.env.SEED_CLIENT_API_KEY,
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[bootstrap-db] failed:', err);
  process.exit(1);
});
