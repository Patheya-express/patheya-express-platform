import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';

import type { UploadFile } from '../../../shared/types/upload-file.type';

import { MenuService } from '../services/menu.service';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import {
  createUploadInterceptorOptions,
  IMAGE_MAX_SIZE_BYTES,
  IMAGE_MIME_TYPES,
} from '../../storage/utils/upload-validation.util';

import { CreateCategoryDto } from '../dto/create-category.dto';

import { CreateMenuItemDto } from '../dto/create-menu-item.dto';

import { Patch } from '@nestjs/common';

import { Delete } from '@nestjs/common';

import { UpdateMenuItemDto } from '../dto/update-menu-item.dto';

import { ToggleMenuItemAvailabilityDto } from '../dto/toggle-menu-item-availability.dto';

import { UpdateCategoryDto } from '../dto/update-category.dto';

import { CreateMenuItemVariantDto } from '../dto/create-menu-item-variant.dto';

import { UpdateMenuItemVariantDto } from '../dto/update-menu-item-variant.dto';

import { CreateAddonDto } from '../dto/create-addon.dto';

import { UpdateAddonDto } from '../dto/update-addon.dto';

import { CreateAddonOptionDto } from '../dto/create-addon-option.dto';

import { UpdateAddonOptionDto } from '../dto/update-addon-option.dto';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { MenuCategoryResponseDto } from '../dto/menu-category-response.dto';

import { MenuItemResponseDto } from '../dto/menu-item-response.dto';

import { MenuItemVariantResponseDto } from '../dto/menu-item-variant-response.dto';

import { MenuAddonResponseDto } from '../dto/menu-addon-response.dto';

import { MenuAddonOptionResponseDto } from '../dto/menu-addon-option-response.dto';

@ApiTags('Menu')
@ApiBearerAuth('JWT-auth')
@Controller('menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create menu category',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiCreatedResponse({
    type: MenuCategoryResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Post('categories')
  createCategory(@CurrentUser() user: any, @Body() dto: CreateCategoryDto) {
    return this.menuService.createCategory(dto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create menu item',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiCreatedResponse({
    type: MenuItemResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Post('items')
  createMenuItem(@CurrentUser() user: any, @Body() dto: CreateMenuItemDto) {
    return this.menuService.createMenuItem(dto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get menu item by ID',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuItemResponseDto,
  })
  @Get('items/:id')
  getMenuItemById(
    @Param('id')
    id: string,
  ) {
    return this.menuService.getMenuItemById(id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update menu item',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuItemResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Patch('items/:id')
  updateMenuItem(
    @CurrentUser() user: any,
    @Param('id')
    id: string,

    @Body()
    dto: UpdateMenuItemDto,
  ) {
    return this.menuService.updateMenuItem(id, dto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Delete menu item',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Delete('items/:id')
  deleteMenuItem(@CurrentUser() user: any, @Param('id') id: string) {
    return this.menuService.deleteMenuItem(id, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Toggle menu item availability',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuItemResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Patch('items/:id/availability')
  toggleAvailability(
    @CurrentUser() user: any,
    @Param('id')
    id: string,

    @Body()
    dto: ToggleMenuItemAvailabilityDto,
  ) {
    return this.menuService.toggleAvailability(id, dto.isAvailable, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get category by ID',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuCategoryResponseDto,
  })
  @Get('categories/:id')
  getCategoryById(
    @Param('id')
    id: string,
  ) {
    return this.menuService.getCategoryById(id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update category',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuCategoryResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Patch('categories/:id')
  updateCategory(
    @CurrentUser() user: any,
    @Param('id')
    id: string,

    @Body()
    dto: UpdateCategoryDto,
  ) {
    return this.menuService.updateCategory(id, dto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Delete category',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Delete('categories/:id')
  deleteCategory(@CurrentUser() user: any, @Param('id') id: string) {
    return this.menuService.deleteCategory(id, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create menu item variant',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiCreatedResponse({
    type: MenuItemVariantResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Post('items/:id/variants')
  createVariant(
    @CurrentUser() user: any,
    @Param('id')
    menuItemId: string,

    @Body()
    dto: CreateMenuItemVariantDto,
  ) {
    return this.menuService.createVariant(menuItemId, dto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update variant',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuItemVariantResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Patch('variants/:id')
  updateVariant(
    @CurrentUser() user: any,
    @Param('id')
    variantId: string,

    @Body()
    dto: UpdateMenuItemVariantDto,
  ) {
    return this.menuService.updateVariant(variantId, dto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Delete variant',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Delete('variants/:id')
  deleteVariant(@CurrentUser() user: any, @Param('id') variantId: string) {
    return this.menuService.deleteVariant(variantId, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create addon group',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiCreatedResponse({
    type: MenuAddonResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Post('items/:id/addons')
  createAddon(
    @CurrentUser() user: any,
    @Param('id') menuItemId: string,
    @Body() dto: CreateAddonDto,
  ) {
    return this.menuService.createAddon(menuItemId, dto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update addon',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuAddonResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Patch('addons/:id')
  updateAddon(
    @CurrentUser() user: any,
    @Param('id') addonId: string,
    @Body() dto: UpdateAddonDto,
  ) {
    return this.menuService.updateAddon(addonId, dto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Delete addon',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Delete('addons/:id')
  deleteAddon(@CurrentUser() user: any, @Param('id') addonId: string) {
    return this.menuService.deleteAddon(addonId, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create addon option',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiCreatedResponse({
    type: MenuAddonOptionResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Post('addons/:id/options')
  createAddonOption(
    @CurrentUser() user: any,
    @Param('id') addonId: string,
    @Body() dto: CreateAddonOptionDto,
  ) {
    return this.menuService.createAddonOption(addonId, dto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update addon option',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuAddonOptionResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Patch('options/:id')
  updateAddonOption(
    @CurrentUser() user: any,
    @Param('id') optionId: string,
    @Body() dto: UpdateAddonOptionDto,
  ) {
    return this.menuService.updateAddonOption(optionId, dto, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Delete addon option',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Delete('options/:id')
  deleteAddonOption(@CurrentUser() user: any, @Param('id') optionId: string) {
    return this.menuService.deleteAddonOption(optionId, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get variant by ID',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuItemVariantResponseDto,
  })
  @Get('variants/:id')
  getVariantById(
    @Param('id')
    variantId: string,
  ) {
    return this.menuService.getVariantById(variantId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get addon by ID',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuAddonResponseDto,
  })
  @Get('addons/:id')
  getAddonById(
    @Param('id')
    addonId: string,
  ) {
    return this.menuService.getAddonById(addonId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get addon option by ID',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuAddonOptionResponseDto,
  })
  @Get('options/:id')
  getAddonOptionById(
    @Param('id')
    optionId: string,
  ) {
    return this.menuService.getAddonOptionById(optionId);
  }

  @ApiOperation({
    summary: 'Get complete restaurant menu',
    description:
      "Public — no authentication required, so anonymous customers can browse a restaurant's menu. Only active categories and available items are returned.",
  })
  @ApiParam({
    name: 'restaurantId',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Matches menu item name within the restaurant',
  })
  @ApiOkResponse({
    type: MenuCategoryResponseDto,
    isArray: true,
  })
  @Get(':restaurantId')
  getRestaurantMenu(
    @Param('restaurantId')
    restaurantId: string,

    @Query('search')
    search?: string,
  ) {
    return this.menuService.getRestaurantMenu(restaurantId, search);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Upload menu item image',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOkResponse({
    type: MenuItemResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadInterceptorOptions(IMAGE_MIME_TYPES, IMAGE_MAX_SIZE_BYTES),
    ),
  )
  @Post('items/:id/image')
  uploadMenuItemImage(
    @CurrentUser() user: any,
    @Param('id')
    id: string,

    @UploadedFile()
    file: UploadFile,
  ) {
    return this.menuService.uploadMenuItemImage(id, file, user);
  }
}
