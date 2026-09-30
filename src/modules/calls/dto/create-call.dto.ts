import { IsObject, IsOptional, Matches, ValidateBy } from 'class-validator';

const E164 = /^\+[1-9]\d{6,14}$/;
const MAX_METADATA_BYTES = 4096;

export class CreateCallDto {
  @Matches(E164, { message: 'from must be an E.164 number, e.g. +14155550100' })
  from!: string;

  @Matches(E164, { message: 'to must be an E.164 number, e.g. +14155550101' })
  to!: string;

  /** Free-form client data echoed back on the call (max 4 KB as JSON). */
  @IsOptional()
  @IsObject()
  @ValidateBy({
    name: 'maxJsonSize',
    validator: {
      validate: (value: unknown) =>
        Buffer.byteLength(JSON.stringify(value ?? {})) <= MAX_METADATA_BYTES,
      defaultMessage: () =>
        `metadata must be at most ${MAX_METADATA_BYTES} bytes as JSON`,
    },
  })
  metadata?: Record<string, unknown>;
}
