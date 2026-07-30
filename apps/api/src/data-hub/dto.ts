import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { ContainerSize } from '@rezo/shared-types';

const SIZES: ContainerSize[] = ['20', '40', 'reefer'];

export class VoyageDto {
  @IsString()
  @MinLength(1)
  vessel_imo!: string;

  @IsString()
  @MinLength(1)
  vessel_name!: string;

  @IsString()
  @MinLength(1)
  voyage_number!: string;

  @IsDateString()
  eta!: string;

  @IsString()
  @MinLength(1)
  port!: string;
}

export class ContainerDto {
  @IsString()
  @MinLength(1)
  container_number!: string;

  @IsIn(SIZES)
  size_type!: ContainerSize;
}

export class BillOfLadingDto {
  @IsString()
  @MinLength(1)
  bl_number!: string;

  @IsString()
  @MinLength(1)
  shipper!: string;

  @IsString()
  @MinLength(1)
  consignee_org_id!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ContainerDto)
  containers!: ContainerDto[];
}

export class SubmitManifestDto {
  @ValidateNested()
  @Type(() => VoyageDto)
  voyage!: VoyageDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BillOfLadingDto)
  bills_of_lading!: BillOfLadingDto[];
}

/**
 * Quick-add a single container — the importer-friendly path (no full manifest).
 * Under the hood it creates a minimal voyage/manifest/bill so the container is a
 * valid record the rest of the platform reads.
 */
export class QuickAddContainerDto {
  @IsString()
  @MinLength(1)
  container_number!: string;

  @IsIn(SIZES)
  size_type!: ContainerSize;

  @IsOptional()
  @IsString()
  bl_number?: string;

  /** Expected or actual arrival date (ISO). Absence is treated as "now". */
  @IsOptional()
  @IsDateString()
  arrival_date?: string;

  /** Admin/broker adding on behalf of an importer; importers add for themselves. */
  @IsOptional()
  @IsString()
  importer_org_id?: string;

  @IsOptional()
  @IsString()
  vessel_name?: string;

  @IsOptional()
  @IsString()
  shipper?: string;

  /** What's inside: "rice", "auto parts", "assorted electronics". */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  goods?: string;
}
