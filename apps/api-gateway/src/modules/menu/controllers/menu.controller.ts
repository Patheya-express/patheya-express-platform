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
  })
  @ApiCreatedResponse({
    type: MenuCategoryResponseDto,
  })
  @Post('categories')
  createCategory(
    @Body()
    dto: CreateCategoryDto,
  ) {
    return this.menuService.createCategory(dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create menu item',
  })
  @ApiCreatedResponse({
    type: MenuItemResponseDto,
  })
  @Post('items')
  createMenuItem(
    @Body()
    dto: CreateMenuItemDto,
  ) {
    return this.menuService.createMenuItem(dto);
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
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuItemResponseDto,
  })
  @Patch('items/:id')
  updateMenuItem(
    @Param('id')
    id: string,

    @Body()
    dto: UpdateMenuItemDto,
  ) {
    return this.menuService.updateMenuItem(
      id,

      dto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Delete menu item',
  })
  @Delete('items/:id')
  deleteMenuItem(
    @Param('id')
    id: string,
  ) {
    return this.menuService.deleteMenuItem(id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Toggle menu item availability',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuItemResponseDto,
  })
  @Patch('items/:id/availability')
  toggleAvailability(
    @Param('id')
    id: string,

    @Body()
    dto: ToggleMenuItemAvailabilityDto,
  ) {
    return this.menuService.toggleAvailability(
      id,

      dto.isAvailable,
    );
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
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuCategoryResponseDto,
  })
  @Patch('categories/:id')
  updateCategory(
    @Param('id')
    id: string,

    @Body()
    dto: UpdateCategoryDto,
  ) {
    return this.menuService.updateCategory(
      id,

      dto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Delete category',
  })
  @Delete('categories/:id')
  deleteCategory(
    @Param('id')
    id: string,
  ) {
    return this.menuService.deleteCategory(id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create menu item variant',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiCreatedResponse({
    type: MenuItemVariantResponseDto,
  })
  @Post('items/:id/variants')
  createVariant(
    @Param('id')
    menuItemId: string,

    @Body()
    dto: CreateMenuItemVariantDto,
  ) {
    return this.menuService.createVariant(
      menuItemId,

      dto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update variant',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuItemVariantResponseDto,
  })
  @Patch('variants/:id')
  updateVariant(
    @Param('id')
    variantId: string,

    @Body()
    dto: UpdateMenuItemVariantDto,
  ) {
    return this.menuService.updateVariant(
      variantId,

      dto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Delete variant',
  })
  @Delete('variants/:id')
  deleteVariant(
    @Param('id')
    variantId: string,
  ) {
    return this.menuService.deleteVariant(variantId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create addon group',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiCreatedResponse({
    type: MenuAddonResponseDto,
  })
  @Post('items/:id/addons')
  createAddon(@Param('id') menuItemId: string, @Body() dto: CreateAddonDto) {
    return this.menuService.createAddon(menuItemId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update addon',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuAddonResponseDto,
  })
  @Patch('addons/:id')
  updateAddon(@Param('id') addonId: string, @Body() dto: UpdateAddonDto) {
    return this.menuService.updateAddon(addonId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Delete addon',
  })
  @Delete('addons/:id')
  deleteAddon(@Param('id') addonId: string) {
    return this.menuService.deleteAddon(addonId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create addon option',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiCreatedResponse({
    type: MenuAddonOptionResponseDto,
  })
  @Post('addons/:id/options')
  createAddonOption(
    @Param('id') addonId: string,
    @Body() dto: CreateAddonOptionDto,
  ) {
    return this.menuService.createAddonOption(addonId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update addon option',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    type: MenuAddonOptionResponseDto,
  })
  @Patch('options/:id')
  updateAddonOption(
    @Param('id') optionId: string,
    @Body() dto: UpdateAddonOptionDto,
  ) {
    return this.menuService.updateAddonOption(optionId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Delete addon option',
  })
  @Delete('options/:id')
  deleteAddonOption(@Param('id') optionId: string) {
    return this.menuService.deleteAddonOption(optionId);
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
  @UseInterceptors(FileInterceptor('file'))
  @Post('items/:id/image')
  uploadMenuItemImage(
    @Param('id')
    id: string,

    @UploadedFile()
    file: UploadFile,
  ) {
    return this.menuService.uploadMenuItemImage(id, file);
  }
}
