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

import { MediaService } from '../services/media.service';

import { UploadMediaDto } from '../dto/upload-media.dto';
import { ReorderMediaDto } from '../dto/reorder-media.dto';
import { MediaResponseDto } from '../dto/media-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import type { UploadFile } from '../../../shared/types/upload-file.type';
import {
  createUploadInterceptorOptions,
  MEDIA_MAX_SIZE_BYTES,
  MEDIA_MIME_TYPES,
} from '../../storage/utils/upload-validation.util';

@ApiTags('Restaurant Media')
@ApiBearerAuth('JWT-auth')
@Controller('restaurants/:restaurantId/media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @ApiOperation({
    summary: 'List gallery media',
    description:
      'Covers gallery/interior/exterior/kitchen/dining/sign-board/video — logo and banner also appear here, mirrored from Restaurant.logoUrl/bannerUrl.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: MediaResponseDto, isArray: true })
  @Get()
  findAll(@Param('restaurantId') restaurantId: string) {
    return this.mediaService.findAll(restaurantId);
  }

  @ApiOperation({ summary: 'Upload a gallery media item' })
  @ApiParam({ name: 'restaurantId' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string' },
        branchId: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ type: MediaResponseDto })
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadInterceptorOptions(MEDIA_MIME_TYPES, MEDIA_MAX_SIZE_BYTES),
    ),
  )
  @Post()
  upload(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Body() dto: UploadMediaDto,
    @UploadedFile() file: UploadFile,
  ) {
    return this.mediaService.upload(restaurantId, dto, file, user);
  }

  @ApiOperation({ summary: 'Reorder gallery media' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: MediaResponseDto, isArray: true })
  @Patch('reorder')
  reorder(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Body() dto: ReorderMediaDto,
  ) {
    return this.mediaService.reorder(restaurantId, dto.mediaIds, user);
  }

  @ApiOperation({ summary: 'Remove a media item' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'mediaId' })
  @Delete(':mediaId')
  remove(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Param('mediaId') mediaId: string,
  ) {
    return this.mediaService.remove(restaurantId, mediaId, user);
  }
}
