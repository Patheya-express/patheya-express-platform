import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

import { FaqService } from '../services/faq.service';

import { CreateFaqDto } from '../dto/create-faq.dto';
import { UpdateFaqDto } from '../dto/update-faq.dto';
import { FaqResponseDto } from '../dto/faq-response.dto';

@ApiTags('Help Center / FAQs')
@Controller('faqs')
export class FaqController {
  constructor(private readonly faqService: FaqService) {}

  @Get()
  @ApiOperation({ summary: 'Get active FAQs, optionally filtered by category' })
  @ApiQuery({ name: 'category', required: false })
  @ApiOkResponse({ type: FaqResponseDto, isArray: true })
  findActive(
    @Query('category')
    category?: string,
  ) {
    return this.faqService.findActive(category);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth('JWT-auth')
  @Get('admin')
  @ApiOperation({ summary: 'Admin — list every FAQ including inactive ones' })
  findAllForAdmin() {
    return this.faqService.findAllForAdmin();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth('JWT-auth')
  @Post('admin')
  @ApiOperation({ summary: 'Admin — create an FAQ entry' })
  create(
    @Body()
    dto: CreateFaqDto,
  ) {
    return this.faqService.create(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth('JWT-auth')
  @Patch('admin/:id')
  @ApiOperation({ summary: 'Admin — update an FAQ entry' })
  update(
    @Param('id')
    id: string,

    @Body()
    dto: UpdateFaqDto,
  ) {
    return this.faqService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth('JWT-auth')
  @Delete('admin/:id')
  @ApiOperation({ summary: 'Admin — delete an FAQ entry' })
  delete(
    @Param('id')
    id: string,
  ) {
    return this.faqService.delete(id);
  }
}
