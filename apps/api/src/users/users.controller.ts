import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { normalizeLimit } from '../common/pagination';
import { CreateUserDto } from './dto';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(Permission.USER_READ)
  list(
    @CurrentUser() principal: AuthPrincipal,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.users.list(principal, normalizeLimit(limit), cursor);
  }

  @Post()
  @RequirePermissions(Permission.USER_WRITE)
  create(@CurrentUser() principal: AuthPrincipal, @Body() dto: CreateUserDto) {
    return this.users.create(principal, dto);
  }
}
