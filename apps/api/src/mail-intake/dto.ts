import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Configure the watched mailbox.
 *
 * NOTE the deliberate absence of a password field. A credential must never
 * travel over the API or come to rest in the database — the caller supplies only
 * the NAME of the environment variable the host keeps the app password in.
 */
export class UpsertConnectionDto {
  @IsEmail()
  address!: string;

  /** IMAP login; defaults to `address`. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsBoolean()
  use_tls?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  folder?: string;

  /** Name of the env var holding the app password. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  secret_env_var?: string;

  @IsOptional()
  @IsIn(['REVIEW_ALL', 'AUTO_CONTAINER', 'AUTO_ALL'])
  autonomy?: 'REVIEW_ALL' | 'AUTO_CONTAINER' | 'AUTO_ALL';

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
