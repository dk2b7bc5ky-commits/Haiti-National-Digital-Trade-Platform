import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { OrgType, KycStatus, OrgStatus } from '@prisma/client';

export class CreateOrganizationDto {
  @IsEnum(OrgType)
  type!: OrgType;

  @IsString()
  @MinLength(2)
  legal_name!: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsEnum(KycStatus)
  kyc_status?: KycStatus;

  @IsOptional()
  @IsEnum(OrgStatus)
  status?: OrgStatus;
}
