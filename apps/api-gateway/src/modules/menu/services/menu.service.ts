import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { MenuRepository } from '../repositories/menu.repository';

import { StorageService } from '../../storage/services/storage.service';
import { UploadFile } from '../../../shared/types/upload-file.type';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  AuthenticatedUser,
  hasRestaurantRole,
} from '../../../shared/authorization/order-access.util';

import { CreateCategoryDto } from '../dto/create-category.dto';

import { CreateMenuItemDto } from '../dto/create-menu-item.dto';
import { UpdateMenuItemDto } from '../dto/update-menu-item.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';
import { CreateMenuItemVariantDto } from '../dto/create-menu-item-variant.dto';
import { UpdateMenuItemVariantDto } from '../dto/update-menu-item-variant.dto';
import { CreateAddonDto } from '../dto/create-addon.dto';
import { UpdateAddonDto } from '../dto/update-addon.dto';
import { CreateAddonOptionDto } from '../dto/create-addon-option.dto';
import { UpdateAddonOptionDto } from '../dto/update-addon-option.dto';

/** Restaurant-scoped roles allowed to mutate a restaurant's menu. Branch-scoped STAFF/
 *  KITCHEN_MANAGER/FINANCE_MANAGER are intentionally excluded — menu is restaurant-wide today,
 *  so only ownership/management-level roles may change it. */
const MENU_MANAGE_ROLES = [
  'OWNER',
  'CO_OWNER',
  'BRANCH_MANAGER',
  'ADMIN',
] as const;

@Injectable()
export class MenuService {
  constructor(
    private readonly menuRepository: MenuRepository,
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  async uploadMenuItemImage(
    menuItemId: string,
    file: UploadFile,
    user: AuthenticatedUser,
  ) {
    const menuItem = await this.menuRepository.getMenuItemById(menuItemId);

    if (!menuItem) {
      throw new NotFoundException('Menu item not found');
    }

    await this.assertCanManageMenu(
      await this.requireMenuItemRestaurantId(menuItemId),
      user,
    );

    const imageUrl = await this.storageService.upload(file, 'menu-items');

    return this.menuRepository.updateMenuItem(menuItemId, { imageUrl });
  }

  async createCategory(dto: CreateCategoryDto, user: AuthenticatedUser) {
    await this.assertCanManageMenu(dto.restaurantId, user);

    return this.menuRepository.createCategory(dto);
  }

  async createMenuItem(dto: CreateMenuItemDto, user: AuthenticatedUser) {
    const restaurantId = await this.requireCategoryRestaurantId(dto.categoryId);

    await this.assertCanManageMenu(restaurantId, user);

    return this.menuRepository.createMenuItem(dto);
  }

  async getRestaurantMenu(restaurantId: string, search?: string) {
    return this.menuRepository.getRestaurantMenu(restaurantId, search);
  }

  async searchMenuItemsAcrossRestaurants(params: {
    search: string;
    skip: number;
    take: number;
  }) {
    return this.menuRepository.searchMenuItemsAcrossRestaurants(params);
  }

  async findMenuItemNameMatches(search: string, limit: number) {
    return this.menuRepository.findMenuItemNameMatches(search, limit);
  }

  async getMenuItemById(menuItemId: string) {
    return this.menuRepository.getMenuItemById(menuItemId);
  }

  async updateMenuItem(
    menuItemId: string,
    dto: UpdateMenuItemDto,
    user: AuthenticatedUser,
  ) {
    await this.assertCanManageMenu(
      await this.requireMenuItemRestaurantId(menuItemId),
      user,
    );

    return this.menuRepository.updateMenuItem(menuItemId, dto);
  }

  async deleteMenuItem(menuItemId: string, user: AuthenticatedUser) {
    await this.assertCanManageMenu(
      await this.requireMenuItemRestaurantId(menuItemId),
      user,
    );

    return this.menuRepository.deleteMenuItem(menuItemId);
  }

  async toggleAvailability(
    menuItemId: string,
    isAvailable: boolean,
    user: AuthenticatedUser,
  ) {
    await this.assertCanManageMenu(
      await this.requireMenuItemRestaurantId(menuItemId),
      user,
    );

    return this.menuRepository.toggleAvailability(menuItemId, isAvailable);
  }

  async getCategoryById(categoryId: string) {
    return this.menuRepository.getCategoryById(categoryId);
  }

  async updateCategory(
    categoryId: string,
    dto: UpdateCategoryDto,
    user: AuthenticatedUser,
  ) {
    await this.assertCanManageMenu(
      await this.requireCategoryRestaurantId(categoryId),
      user,
    );

    return this.menuRepository.updateCategory(categoryId, dto);
  }

  async deleteCategory(categoryId: string, user: AuthenticatedUser) {
    await this.assertCanManageMenu(
      await this.requireCategoryRestaurantId(categoryId),
      user,
    );

    return this.menuRepository.deleteCategory(categoryId);
  }

  async createVariant(
    menuItemId: string,
    dto: CreateMenuItemVariantDto,
    user: AuthenticatedUser,
  ) {
    await this.assertCanManageMenu(
      await this.requireMenuItemRestaurantId(menuItemId),
      user,
    );

    return this.menuRepository.createVariant(menuItemId, dto);
  }

  async updateVariant(
    variantId: string,
    dto: UpdateMenuItemVariantDto,
    user: AuthenticatedUser,
  ) {
    await this.assertCanManageMenu(
      await this.requireVariantRestaurantId(variantId),
      user,
    );

    return this.menuRepository.updateVariant(variantId, dto);
  }

  async deleteVariant(variantId: string, user: AuthenticatedUser) {
    await this.assertCanManageMenu(
      await this.requireVariantRestaurantId(variantId),
      user,
    );

    return this.menuRepository.deleteVariant(variantId);
  }

  async createAddon(
    menuItemId: string,
    dto: CreateAddonDto,
    user: AuthenticatedUser,
  ) {
    await this.assertCanManageMenu(
      await this.requireMenuItemRestaurantId(menuItemId),
      user,
    );

    return this.menuRepository.createAddon(menuItemId, dto);
  }

  async updateAddon(
    addonId: string,
    dto: UpdateAddonDto,
    user: AuthenticatedUser,
  ) {
    await this.assertCanManageMenu(
      await this.requireAddonRestaurantId(addonId),
      user,
    );

    return this.menuRepository.updateAddon(addonId, dto);
  }

  async deleteAddon(addonId: string, user: AuthenticatedUser) {
    await this.assertCanManageMenu(
      await this.requireAddonRestaurantId(addonId),
      user,
    );

    return this.menuRepository.deleteAddon(addonId);
  }

  async createAddonOption(
    addonId: string,
    dto: CreateAddonOptionDto,
    user: AuthenticatedUser,
  ) {
    await this.assertCanManageMenu(
      await this.requireAddonRestaurantId(addonId),
      user,
    );

    return this.menuRepository.createAddonOption(addonId, dto);
  }

  async updateAddonOption(
    optionId: string,
    dto: UpdateAddonOptionDto,
    user: AuthenticatedUser,
  ) {
    await this.assertCanManageMenu(
      await this.requireAddonOptionRestaurantId(optionId),
      user,
    );

    return this.menuRepository.updateAddonOption(optionId, dto);
  }

  async deleteAddonOption(optionId: string, user: AuthenticatedUser) {
    await this.assertCanManageMenu(
      await this.requireAddonOptionRestaurantId(optionId),
      user,
    );

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

  /** Single source of truth for menu-mutation authorization — mirrors the pattern already used
   *  by BranchesService/StaffService/BankAccountService rather than introducing a second
   *  authorization mechanism. */
  private async assertCanManageMenu(
    restaurantId: string,
    user: AuthenticatedUser,
  ) {
    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...MENU_MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to manage this restaurant menu',
      );
    }
  }

  private async requireCategoryRestaurantId(
    categoryId: string,
  ): Promise<string> {
    const restaurantId =
      await this.menuRepository.getCategoryRestaurantId(categoryId);

    if (!restaurantId) {
      throw new NotFoundException('Menu category not found');
    }

    return restaurantId;
  }

  private async requireMenuItemRestaurantId(
    menuItemId: string,
  ): Promise<string> {
    const restaurantId =
      await this.menuRepository.getMenuItemRestaurantId(menuItemId);

    if (!restaurantId) {
      throw new NotFoundException('Menu item not found');
    }

    return restaurantId;
  }

  private async requireVariantRestaurantId(variantId: string): Promise<string> {
    const restaurantId =
      await this.menuRepository.getVariantRestaurantId(variantId);

    if (!restaurantId) {
      throw new NotFoundException('Menu item variant not found');
    }

    return restaurantId;
  }

  private async requireAddonRestaurantId(addonId: string): Promise<string> {
    const restaurantId =
      await this.menuRepository.getAddonRestaurantId(addonId);

    if (!restaurantId) {
      throw new NotFoundException('Addon group not found');
    }

    return restaurantId;
  }

  private async requireAddonOptionRestaurantId(
    optionId: string,
  ): Promise<string> {
    const restaurantId =
      await this.menuRepository.getAddonOptionRestaurantId(optionId);

    if (!restaurantId) {
      throw new NotFoundException('Addon option not found');
    }

    return restaurantId;
  }
}
