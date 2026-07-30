import { IsInt, IsISO8601, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTransportJobDto {
  @IsString()
  container_id!: string;

  @IsOptional()
  @IsString()
  trucker_org_id?: string;

  @IsString()
  @MinLength(1)
  pickup!: string;

  @IsString()
  @MinLength(1)
  dropoff!: string;

  @IsInt()
  @Min(0)
  price!: number; // minor units

  @IsOptional()
  @IsString()
  currency?: string;
}

export class GpsDto {
  @Type(() => Number)
  @IsNumber()
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  lng!: number;
}

export class CreateGateAppointmentDto {
  @IsString()
  container_id!: string;

  @IsOptional()
  @IsString()
  trucker_org_id?: string;

  @IsISO8601()
  slot_time!: string;
}
