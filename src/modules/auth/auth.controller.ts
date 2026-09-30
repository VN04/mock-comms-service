import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiKeyRole } from '../../common/auth/api-key-context';
import { Roles } from '../../common/decorators/auth.decorators';
import { AuthService } from './auth.service';
import {
  ApiKeyResponse,
  CreateApiKeyDto,
  toApiKeyResponse,
  UpdateApiKeyDto,
} from './dto/api-key.dto';

/** Admin-only API key management. */
@Controller('admin/api-keys')
@Roles(ApiKeyRole.ADMIN)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post()
  async create(
    @Body() dto: CreateApiKeyDto,
  ): Promise<ApiKeyResponse & { api_key: string }> {
    const { entity, rawKey } = await this.auth.createKey(dto);
    // The raw key is only ever shown in this response.
    return { ...toApiKeyResponse(entity), api_key: rawKey };
  }

  @Get()
  async list(): Promise<ApiKeyResponse[]> {
    return (await this.auth.listKeys()).map(toApiKeyResponse);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApiKeyDto,
  ): Promise<ApiKeyResponse> {
    return toApiKeyResponse(await this.auth.updateKey(id, dto));
  }

  /** Soft revoke: the key stops working immediately; its history is kept. */
  @Delete(':id')
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiKeyResponse> {
    return toApiKeyResponse(await this.auth.revokeKey(id));
  }
}
