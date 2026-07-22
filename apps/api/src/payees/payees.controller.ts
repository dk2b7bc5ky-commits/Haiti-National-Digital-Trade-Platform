import { Body, Controller, Get, Post } from '@nestjs/common';
import { PayeesService } from './payees.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { CreatePayeeDto } from './dto';

@Controller('payees')
export class PayeesController {
  constructor(private readonly payees: PayeesService) {}

  @Get()
  @RequirePermissions(Permission.CHARGE_READ)
  list() {
    return this.payees.list();
  }

  @Post()
  @RequirePermissions(Permission.CONFIG_MANAGE)
  create(@CurrentUser() principal: AuthPrincipal, @Body() dto: CreatePayeeDto) {
    return this.payees.create(principal, dto);
  }
}
