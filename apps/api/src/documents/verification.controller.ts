import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { normalizeLimit } from '../common/pagination';
import { ResolveTaskDto } from './dto';

@Controller('verification-tasks')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get()
  @RequirePermissions(Permission.VERIFICATION_READ)
  list(
    @CurrentUser() principal: AuthPrincipal,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.verification.listTasks(principal, status, normalizeLimit(limit));
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions(Permission.VERIFICATION_RESOLVE)
  resolve(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: ResolveTaskDto,
  ) {
    return this.verification.resolve(principal, id, dto);
  }
}
