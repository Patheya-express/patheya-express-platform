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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { DocumentsService } from '../services/documents.service';

import { UploadDocumentDto } from '../dto/upload-document.dto';
import { RejectDocumentDto } from '../dto/reject-document.dto';
import { DocumentResponseDto } from '../dto/document-response.dto';

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

@ApiTags('Restaurant Documents')
@ApiBearerAuth('JWT-auth')
@Controller('restaurants/:restaurantId/documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @ApiOperation({
    summary: 'List the latest version of every document for a restaurant',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: DocumentResponseDto, isArray: true })
  @Get()
  findAll(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.documentsService.findAll(restaurantId, user);
  }

  @ApiOperation({
    summary: 'Upload a document',
    description:
      'Set previousVersionId to replace an existing document — the old version is marked isLatest=false rather than deleted.',
  })
  @ApiParam({ name: 'restaurantId' })
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
        branchId: { type: 'string' },
        previousVersionId: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ type: DocumentResponseDto })
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
    @Param('restaurantId') restaurantId: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: UploadFile,
  ) {
    return this.documentsService.upload(restaurantId, dto, file, user);
  }

  @ApiOperation({ summary: 'Verify a document (admin only)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'documentId' })
  @ApiOkResponse({ type: DocumentResponseDto })
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':documentId/verify')
  verify(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documentsService.verify(restaurantId, documentId, user);
  }

  @ApiOperation({ summary: 'Reject a document (admin only)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'documentId' })
  @ApiOkResponse({ type: DocumentResponseDto })
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':documentId/reject')
  reject(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Param('documentId') documentId: string,
    @Body() dto: RejectDocumentDto,
  ) {
    return this.documentsService.reject(
      restaurantId,
      documentId,
      dto.rejectedReason,
      user,
    );
  }

  @ApiOperation({ summary: 'Remove a document (soft delete)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'documentId' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  @Delete(':documentId')
  remove(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documentsService.remove(restaurantId, documentId, user);
  }
}
