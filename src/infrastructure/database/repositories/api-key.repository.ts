import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiKeyEntity } from '../entities/api-key.entity';

export type NewApiKey = Pick<
  ApiKeyEntity,
  'id' | 'name' | 'keyPrefix' | 'keyHash' | 'role'
> &
  Partial<Pick<ApiKeyEntity, 'maxConcurrentCalls' | 'maxCps'>>;

export type ApiKeyPatch = Partial<
  Pick<ApiKeyEntity, 'name' | 'maxConcurrentCalls' | 'maxCps' | 'isActive'>
>;

/** MySQL access for API keys. */
@Injectable()
export class ApiKeyRepository {
  constructor(
    @InjectRepository(ApiKeyEntity)
    private readonly repo: Repository<ApiKeyEntity>,
  ) {}

  findActiveByHash(keyHash: string): Promise<ApiKeyEntity | null> {
    return this.repo.findOneBy({ keyHash, isActive: true });
  }

  findById(id: string): Promise<ApiKeyEntity | null> {
    return this.repo.findOneBy({ id });
  }

  findByName(name: string): Promise<ApiKeyEntity | null> {
    return this.repo.findOneBy({ name });
  }

  findAll(): Promise<ApiKeyEntity[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  create(data: NewApiKey): Promise<ApiKeyEntity> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: string, patch: ApiKeyPatch): Promise<ApiKeyEntity | null> {
    await this.repo.update({ id }, patch);
    return this.findById(id);
  }

  async revoke(id: string): Promise<ApiKeyEntity | null> {
    await this.repo.update({ id }, { isActive: false, revokedAt: new Date() });
    return this.findById(id);
  }
}
