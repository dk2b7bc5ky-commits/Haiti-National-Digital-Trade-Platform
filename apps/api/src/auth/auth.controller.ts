import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public, CurrentUser } from './decorators';
import { AuthPrincipal } from './auth-principal';
import { LoginDto, ApiKeyTokenDto } from './dto';
import type { LoginResponse, TokenResponse, AuthContext } from '@rezo/shared-types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.auth.login(dto.email, dto.password);
  }

  @Public()
  @Post('token')
  @HttpCode(200)
  token(@Body() dto: ApiKeyTokenDto): Promise<TokenResponse> {
    return this.auth.exchangeApiKey(dto.api_key);
  }

  @Get('me')
  me(@CurrentUser() principal: AuthPrincipal): Promise<AuthContext> {
    return this.auth.me(principal);
  }
}
