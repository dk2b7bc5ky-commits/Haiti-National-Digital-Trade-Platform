import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { IsString } from 'class-validator';
import { BrokerService } from './broker.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';

class AddClientDto {
  @IsString()
  importer_org_id!: string;
}

@Controller('broker/clients')
export class BrokerController {
  constructor(private readonly broker: BrokerService) {}

  @Get()
  @RequirePermissions(Permission.BROKER_MANAGE)
  list(@CurrentUser() principal: AuthPrincipal, @Query('broker_org_id') brokerOrgId?: string) {
    return this.broker.listClients(principal, brokerOrgId);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(Permission.BROKER_MANAGE)
  add(@CurrentUser() principal: AuthPrincipal, @Body() dto: AddClientDto) {
    return this.broker.addClient(principal, dto.importer_org_id);
  }

  @Delete(':id')
  @RequirePermissions(Permission.BROKER_MANAGE)
  remove(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    return this.broker.removeClient(principal, id);
  }
}
