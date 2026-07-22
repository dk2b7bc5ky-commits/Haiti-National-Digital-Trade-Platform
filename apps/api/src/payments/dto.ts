import { ArrayMinSize, IsArray, IsIn, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePaymentRequestDto {
  @IsString()
  container_id!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  charge_ids!: string[];

  @IsString()
  @MinLength(3)
  settlement_currency!: string;
}

export class AuthorizePaymentDto {
  /** Beta/mock only: { "<payeeOrgId>": "settled"|"failed"|"pending" }. */
  @IsOptional()
  @IsObject()
  simulate?: Record<string, 'settled' | 'failed' | 'pending'>;
}

export class SetFxRateDto {
  @IsString()
  base!: string;

  @IsString()
  quote!: string;

  @IsIn(['manual', 'mock', 'config'])
  @IsOptional()
  source?: 'manual' | 'mock' | 'config';
}
