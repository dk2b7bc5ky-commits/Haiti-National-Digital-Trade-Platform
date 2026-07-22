import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UploadDocumentDto {
  @IsOptional()
  @IsString()
  container_id?: string;

  @IsOptional()
  @IsString()
  doc_type?: string;
}

export class ResolveTaskDto {
  @IsOptional()
  @IsString()
  field?: string;

  /** Corrected amount in minor units (spec §15). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  corrected_value?: number;
}
