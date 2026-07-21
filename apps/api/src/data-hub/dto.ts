import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
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
