import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class PreferenceItemDto {
  @IsString()
  type!: string;

  @IsBoolean()
  in_app!: boolean;

  @IsBoolean()
  email!: boolean;
}

export class UpdatePreferencesDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreferenceItemDto)
  preferences?: PreferenceItemDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  quiet_start?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  quiet_end?: number | null;
}
