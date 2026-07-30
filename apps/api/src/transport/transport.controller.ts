import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TransportService } from './transport.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { CreateTransportJobDto, CreateGateAppointmentDto, GpsDto } from './dto';

interface UF { originalname: string; mimetype: string; buffer: Buffer; }

@Controller('transport-jobs')
export class TransportJobsController {
  constructor(private readonly transport: TransportService) {}

  @Get()
  @RequirePermissions(Permission.CONTAINER_READ)
  list(@CurrentUser() principal: AuthPrincipal) {
    return this.transport.listJobs(principal);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(Permission.TRANSPORT_MANAGE)
  create(@CurrentUser() principal: AuthPrincipal, @Body() dto: CreateTransportJobDto) {
    return this.transport.createJob(principal, dto);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @RequirePermissions(Permission.TRANSPORT_DRIVE)
  accept(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    return this.transport.accept(principal, id);
  }

  @Post(':id/insurance')
  @HttpCode(200)
  @RequirePermissions(Permission.TRANSPORT_DRIVE)
  @UseInterceptors(FileInterceptor('file'))
  insurance(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string, @UploadedFile() file: UF) {
    return this.transport.uploadFile(principal, id, 'insurance', file);
  }

  @Post(':id/pod')
  @HttpCode(200)
  @RequirePermissions(Permission.TRANSPORT_DRIVE)
  @UseInterceptors(FileInterceptor('file'))
  pod(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string, @UploadedFile() file: UF) {
    return this.transport.uploadFile(principal, id, 'pod', file);
  }

  @Post(':id/gps')
  @HttpCode(200)
  @RequirePermissions(Permission.TRANSPORT_DRIVE)
  gps(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string, @Body() dto: GpsDto) {
    return this.transport.setGps(principal, id, dto);
  }
}

@Controller('gate-appointments')
export class GateAppointmentsController {
  constructor(private readonly transport: TransportService) {}

  @Get()
  @RequirePermissions(Permission.CONTAINER_READ)
  list(@CurrentUser() principal: AuthPrincipal) {
    return this.transport.listGate(principal);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(Permission.TRANSPORT_DRIVE)
  book(@CurrentUser() principal: AuthPrincipal, @Body() dto: CreateGateAppointmentDto) {
    return this.transport.bookGate(principal, dto);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequirePermissions(Permission.GATE_MANAGE)
  confirm(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    return this.transport.setGateStatus(principal, id, 'CONFIRMED');
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions(Permission.GATE_MANAGE)
  complete(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    return this.transport.setGateStatus(principal, id, 'COMPLETED');
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.CONTAINER_READ)
  cancel(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    return this.transport.setGateStatus(principal, id, 'CANCELLED');
  }
}
