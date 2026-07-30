import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateMarketDto {
  @IsOptional()
  @IsObject()
  tariff?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  currencies?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabled_modules?: string[];
}
