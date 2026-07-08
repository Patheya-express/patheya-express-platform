import { Injectable, NotFoundException } from '@nestjs/common';

import { MenuRepository } from '../repositories/menu.repository';

import { StorageService } from '../../storage/services/storage.service';
import { UploadFile } from '../../../shared/types/upload-file.type';

import { CreateCategoryDto } from '../dto/create-category.dto';

import { CreateMenuItemDto } from '../dto/create-menu-item.dto';
import { UpdateMenuItemDto } from '../dto/update-menu-item.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';
import { CreateMenuItemVariantDto } from '../dto/create-menu-item-variant.dto';
import { UpdateMenuItemVariantDto } from '../dto/update-menu-item-variant.dto';
import { CreateAddonDto } from '../dto/create-addon.dto';
import { UpdateAddonDto } from '../dto/update-addon.dto';
import { CreateContextOptions } from 'vm';
import { UpdateAddonOptionDto } from '../dto/update-addon-option.dto';

@Injectable()
export class MenuService {
  constructor(
    private readonly menuRepository: MenuRepository,
    private readonly storageService: StorageService,
  ) {}

  async uploadMenuItemImage(menuItemId: string, file: UploadFile) {
    const menuItem = await this.menuRepository.getMenuItemById(menuItemId);

    if (!menuItem) {
      throw new NotFoundException('Menu item not found');
    }

    const imageUrl = await this.storageService.upload(file, 'menu-items');

    return this.menuRepository.updateMenuItem(menuItemId, { imageUrl });
  }

  async createCategory(dto: CreateCategoryDto) {
    return this.menuRepository.createCategory(dto);
  }

  async createMenuItem(dto: CreateMenuItemDto) {
    return this.menuRepository.createMenuItem(dto);
  }

  async getRestaurantMenu(restaurantId: string, search?: string) {
    return this.menuRepository.getRestaurantMenu(restaurantId, search);
  }
  async getMenuItemById(menuItemId: string) {
    return this.menuRepository.getMenuItemById(menuItemId);
  }

  async updateMenuItem(
    menuItemId: string,

    dto: UpdateMenuItemDto,
  ) {
    return this.menuRepository.updateMenuItem(
      menuItemId,

      dto,
    );
  }

  async deleteMenuItem(menuItemId: string) {
    return this.menuRepository.deleteMenuItem(menuItemId);
  }

  async toggleAvailability(
    menuItemId: string,

    isAvailable: boolean,
  ) {
    return this.menuRepository.toggleAvailability(
      menuItemId,

      isAvailable,
    );
  }
  async getCategoryById(categoryId: string) {
    return this.menuRepository.getCategoryById(categoryId);
  }

  async updateCategory(
    categoryId: string,

    dto: UpdateCategoryDto,
  ) {
    return this.menuRepository.updateCategory(
      categoryId,

      dto,
    );
  }

  async deleteCategory(categoryId: string) {
    return this.menuRepository.deleteCategory(categoryId);
  }
  async createVariant(
    menuItemId: string,

    dto: CreateMenuItemVariantDto,
  ) {
    return this.menuRepository.createVariant(
      menuItemId,

      dto,
    );
  }

  async updateVariant(
    variantId: string,

    dto: UpdateMenuItemVariantDto,
  ) {
    return this.menuRepository.updateVariant(
      variantId,

      dto,
    );
  }

  async deleteVariant(variantId: string) {
    return this.menuRepository.deleteVariant(variantId);
  }
  async createAddon(
    menuItemId: string,

    dto: CreateAddonDto,
  ) {
    return this.menuRepository.createAddon(
      menuItemId,

      dto,
    );
  }

  async updateAddon(
    addonId: string,

    dto: UpdateAddonDto,
  ) {
    return this.menuRepository.updateAddon(
      addonId,

      dto,
    );
  }

  async deleteAddon(addonId: string) {
    return this.menuRepository.deleteAddon(addonId);
  }

  async createAddonOption(
    addonId: string,

    dto: CreateContextOptions,
  ) {
    return this.menuRepository.createAddonOption(
      addonId,

      dto,
    );
  }

  async updateAddonOption(
    optionId: string,

    dto: UpdateAddonOptionDto,
  ) {
    return this.menuRepository.updateAddonOption(
      optionId,

      dto,
    );
  }

  async deleteAddonOption(optionId: string) {
    return this.menuRepository.deleteAddonOption(optionId);
  }
  async getVariantById(variantId: string) {
    return this.menuRepository.getVariantById(variantId);
  }

  async getAddonById(addonId: string) {
    return this.menuRepository.getAddonById(addonId);
  }

  async getAddonOptionById(optionId: string) {
    return this.menuRepository.getAddonOptionById(optionId);
  }
}
