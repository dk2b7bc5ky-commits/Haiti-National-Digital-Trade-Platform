import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService, UploadedFile as UF } from './documents.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { UploadDocumentDto } from './dto';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** Multipart upload; stores the file and triggers (mock) extraction. */
  @Post()
  @HttpCode(201)
  @RequirePermissions(Permission.DOCUMENT_WRITE)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() principal: AuthPrincipal,
    @UploadedFile() file: UF,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.documents.upload(principal, file, dto);
  }

  /** Remove an uploaded document and the (unpaid) charges it produced. */
  @Delete(':id')
  @RequirePermissions(Permission.DOCUMENT_WRITE)
  remove(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    return this.documents.deleteDocument(principal, id);
  }
}

@Controller('containers/:containerId/documents')
export class ContainerDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequirePermissions(Permission.CONTAINER_READ)
  list(@CurrentUser() principal: AuthPrincipal, @Param('containerId') containerId: string) {
    return this.documents.listForContainer(principal, containerId);
  }
}
