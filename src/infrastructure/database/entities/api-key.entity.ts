import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiKeyRole } from '../../../common/auth/api-key-context';

/** An API key. Only the SHA-256 hash of the secret is stored. */
@Entity('api_keys')
export class ApiKeyEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /** First characters of the raw key, safe to display for identification. */
  @Column({ name: 'key_prefix', type: 'varchar', length: 16 })
  keyPrefix!: string;

  @Column({ name: 'key_hash', type: 'char', length: 64, unique: true })
  keyHash!: string;

  @Column({ type: 'enum', enum: ApiKeyRole, default: ApiKeyRole.CLIENT })
  role!: ApiKeyRole;

  /** Per-key override; NULL falls back to the global default. */
  @Column({ name: 'max_concurrent_calls', type: 'int', nullable: true })
  maxConcurrentCalls!: number | null;

  /** Per-key override; NULL falls back to the global default. */
  @Column({ name: 'max_cps', type: 'int', nullable: true })
  maxCps!: number | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;

  @Column({
    name: 'revoked_at',
    type: 'datetime',
    precision: 3,
    nullable: true,
  })
  revokedAt!: Date | null;
}
