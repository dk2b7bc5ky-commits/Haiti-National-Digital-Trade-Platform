import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { PayeeType } from '@rezo/shared-types';

const PAYEE_TYPES: PayeeType[] = ['customs', 'port', 'terminal', 'line', 'rezo', 'other'];

export class CreatePayeeDto {
  @IsString()
  org_id!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsIn(PAYEE_TYPES)
  type!: PayeeType;

  @IsString()
  @MinLength(1)
  settlement_ref!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
