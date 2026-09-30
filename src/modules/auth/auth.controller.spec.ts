import { Test } from '@nestjs/testing';
import { ApiKeyRole } from '../../common/auth/api-key-context';
import { ApiKeyEntity } from '../../infrastructure/database/entities/api-key.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const entity = {
  id: 'key-1',
  name: 'acme',
  keyPrefix: 'mcs_abc',
  keyHash: 'hash',
  role: ApiKeyRole.CLIENT,
  maxConcurrentCalls: 5,
  maxCps: null,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  revokedAt: null,
} as ApiKeyEntity;

describe('AuthController', () => {
  let controller: AuthController;
  const auth = {
    createKey: jest.fn(),
    listKeys: jest.fn(),
    updateKey: jest.fn(),
    revokeKey: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compile();
    controller = module.get(AuthController);
  });

  it('returns the raw key only on creation, never the hash', async () => {
    auth.createKey.mockResolvedValue({ entity, rawKey: 'mcs_secret' });

    const res = await controller.create({ name: 'acme' });

    expect(res).toMatchObject({
      id: 'key-1',
      api_key: 'mcs_secret',
      key_prefix: 'mcs_abc',
      max_concurrent_calls: 5,
      max_cps: null,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(JSON.stringify(res)).not.toContain('hash');
  });

  it('lists keys without secrets', async () => {
    auth.listKeys.mockResolvedValue([entity]);
    const [key] = await controller.list();
    expect(key).not.toHaveProperty('api_key');
    expect(key).not.toHaveProperty('key_hash');
  });
});
