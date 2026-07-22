import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ChargesService } from './charges.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { CreateChargeDto } from './dto';

/** Container-level actions that create charges (e.g. requesting inspection). */
@Controller('containers/:containerId')
export class ContainerActionsController {
  constructor(private readonly charges: ChargesService) {}

  @Post('request-inspection')
  @HttpCode(201)
  @RequirePermissions(Permission.INSPECTION_REQUEST)
  requestInspection(@CurrentUser() principal: AuthPrincipal, @Param('containerId') containerId: string) {
    return this.charges.requestInspection(principal, containerId);
  }
}

/** Charges are nested under a container (spec §7: a charge belongs to one). */
@Controller('containers/:containerId/charges')
export class ChargesController {
  constructor(private readonly charges: ChargesService) {}

  @Get()
  @RequirePermissions(Permission.CHARGE_READ)
  list(@CurrentUser() principal: AuthPrincipal, @Param('containerId') containerId: string) {
    return this.charges.listForContainer(principal, containerId);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(Permission.CHARGE_WRITE)
  create(
    @CurrentUser() principal: AuthPrincipal,
    @Param('containerId') containerId: string,
    @Body() dto: CreateChargeDto,
  ) {
    return this.charges.createManual(principal, containerId, dto);
  }

  /** Pull terminal-side charges via the (mock) TerminalAdapter. */
  @Post('sync-terminal')
  @HttpCode(200)
  @RequirePermissions(Permission.CHARGE_WRITE)
  syncTerminal(@CurrentUser() principal: AuthPrincipal, @Param('containerId') containerId: string) {
    return this.charges.syncTerminal(principal, containerId);
  }
}
