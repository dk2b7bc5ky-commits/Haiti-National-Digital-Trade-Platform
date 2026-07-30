import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Min } from 'class-validator';
import type { ChargeType } from '@rezo/shared-types';

const CHARGE_TYPES: ChargeType[] = [
  'customs_duty', 'customs_fee', 'port_dues', 'terminal_handling', 'storage',
  'demurrage', 'detention', 'inspection', 'scanning', 'rezo_fee',
];

export class CreateChargeDto {
  @IsIn(CHARGE_TYPES)
  type!: ChargeType;

  /** Integer minor units (e.g. USD cents). Never a float (spec §15). */
  @IsInt()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  /** Explicit payee org; if omitted, resolved from the charge type's payee. */
  @IsOptional()
  @IsString()
  payee_org_id?: string;

  @IsOptional()
  @IsISO8601()
  due_date?: string;

  @IsOptional()
  @IsISO8601()
  last_free_day?: string;
}
