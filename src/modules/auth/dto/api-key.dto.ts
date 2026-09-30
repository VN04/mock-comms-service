import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiKeyRole } from '../../../common/auth/api-key-context';
import { ApiKeyEntity } from '../../../infrastructure/database/entities/api-key.entity';

/** Limits accept a number, or `null` to fall back to the global default. */
class ApiKeyLimitsDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(10000)
  max_concurrent_calls?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(10000)
  max_cps?: number | null;
}

export class CreateApiKeyDto extends ApiKeyLimitsDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsEnum(ApiKeyRole)
  role?: ApiKeyRole;
}

export class UpdateApiKeyDto extends ApiKeyLimitsDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export interface ApiKeyResponse {
  id: string;
  name: string;
  key_prefix: string;
  role: ApiKeyRole;
  max_concurrent_calls: number | null;
  max_cps: number | null;
  is_active: boolean;
  created_at: string;
  revoked_at: string | null;
}

export const toApiKeyResponse = (e: ApiKeyEntity): ApiKeyResponse => ({
  id: e.id,
  name: e.name,
  key_prefix: e.keyPrefix,
  role: e.role,
  max_concurrent_calls: e.maxConcurrentCalls,
  max_cps: e.maxCps,
  is_active: e.isActive,
  created_at: e.createdAt.toISOString(),
  revoked_at: e.revokedAt?.toISOString() ?? null,
});
