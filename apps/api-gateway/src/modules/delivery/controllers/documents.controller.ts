import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';

import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { DeliveryDocumentType, UserRole } from '@prisma/client';

import { DocumentsService } from '../services/documents.service';

import { UploadDeliveryDocumentDto } from '../dto/upload-delivery-document.dto';
import { RejectDeliveryDocumentDto } from '../dto/reject-delivery-document.dto';
import {
  DeliveryDocumentResponseDto,
  DocumentVersionResponseDto,
} from '../dto/delivery-document-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import type { UploadFile } from '../../../shared/types/upload-file.type';
import {
  createUploadInterceptorOptions,
  DOCUMENT_MAX_SIZE_BYTES,
  DOCUMENT_MIME_TYPES,
} from '../../storage/utils/upload-validation.util';

@ApiTags('Delivery Documents')
@ApiBearerAuth('JWT-auth')
@Controller('delivery/documents')
@UseGuards(JwtAuthGuard)
export class DeliveryDocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @ApiOperation({
    summary: 'List the latest version of every one of my documents',
  })
  @ApiOkResponse({ type: DeliveryDocumentResponseDto, isArray: true })
  @Get()
  findAll(@CurrentUser() user: any) {
    return this.documentsService.findAllForSelf(user.userId);
  }

  @ApiOperation({
    summary: 'Upload a document',
    description:
      'Set previousVersionId to replace an existing document — the old version is marked isLatest=false rather than deleted.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        documentType: { type: 'string' },
        documentNumber: { type: 'string' },
        issueDate: { type: 'string', format: 'date' },
        expiryDate: { type: 'string', format: 'date' },
        vehicleId: { type: 'string' },
        previousVersionId: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ type: DeliveryDocumentResponseDto })
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadInterceptorOptions(
        DOCUMENT_MIME_TYPES,
        DOCUMENT_MAX_SIZE_BYTES,
      ),
    ),
  )
  @Post()
  upload(
    @CurrentUser() user: any,
    @Body() dto: UploadDeliveryDocumentDto,
    @UploadedFile() file: UploadFile,
  ) {
    return this.documentsService.upload(user.userId, dto, file);
  }

  @ApiOperation({ summary: 'Version history for one document type' })
  @ApiParam({ name: 'documentType', enum: DeliveryDocumentType })
  @ApiOkResponse({ type: DocumentVersionResponseDto, isArray: true })
  @Get(':documentType/history')
  history(
    @CurrentUser() user: any,
    @Param('documentType') documentType: DeliveryDocumentType,
  ) {
    return this.documentsService.historyForSelf(user.userId, documentType);
  }

  @ApiOperation({ summary: 'Remove a document (soft delete)' })
  @ApiParam({ name: 'documentId' })
  @Delete(':documentId')
  remove(@CurrentUser() user: any, @Param('documentId') documentId: string) {
    return this.documentsService.remove(user.userId, documentId);
  }
}

@ApiTags('Delivery Documents (Admin)')
@ApiBearerAuth('JWT-auth')
@Controller('delivery/admin/:deliveryPartnerId/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminDocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @ApiOperation({
    summary: 'List the latest version of every document for a partner',
  })
  @ApiParam({ name: 'deliveryPartnerId' })
  @ApiOkResponse({ type: DeliveryDocumentResponseDto, isArray: true })
  @Get()
  findAll(@Param('deliveryPartnerId') deliveryPartnerId: string) {
    return this.documentsService.findAllForAdmin(deliveryPartnerId);
  }

  @ApiOperation({ summary: 'Version history for one document type' })
  @ApiParam({ name: 'deliveryPartnerId' })
  @ApiParam({ name: 'documentType', enum: DeliveryDocumentType })
  @ApiOkResponse({ type: DocumentVersionResponseDto, isArray: true })
  @Get(':documentType/history')
  history(
    @Param('deliveryPartnerId') deliveryPartnerId: string,
    @Param('documentType') documentType: DeliveryDocumentType,
  ) {
    return this.documentsService.historyForAdmin(
      deliveryPartnerId,
      documentType,
    );
  }

  @ApiOperation({ summary: 'Verify a document' })
  @ApiParam({ name: 'deliveryPartnerId' })
  @ApiParam({ name: 'documentId' })
  @ApiOkResponse({ type: DeliveryDocumentResponseDto })
  @Patch(':documentId/verify')
  verify(
    @CurrentUser() user: any,
    @Param('deliveryPartnerId') deliveryPartnerId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documentsService.verify(
      deliveryPartnerId,
      documentId,
      user.userId,
    );
  }

  @ApiOperation({ summary: 'Reject a document' })
  @ApiParam({ name: 'deliveryPartnerId' })
  @ApiParam({ name: 'documentId' })
  @ApiOkResponse({ type: DeliveryDocumentResponseDto })
  @Patch(':documentId/reject')
  reject(
    @CurrentUser() user: any,
    @Param('deliveryPartnerId') deliveryPartnerId: string,
    @Param('documentId') documentId: string,
    @Body() dto: RejectDeliveryDocumentDto,
  ) {
    return this.documentsService.reject(
      deliveryPartnerId,
      documentId,
      dto.rejectedReason,
      user.userId,
    );
  }
}
