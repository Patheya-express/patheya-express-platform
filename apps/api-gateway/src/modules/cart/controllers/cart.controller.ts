import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { CartService } from '../services/cart.service';

import { AddCartItemDto } from '../dto/add-cart-item.dto';
import { UpdateCartItemDto } from '../dto/update-cart-item.dto';
import { CartResponseDto } from '../dto/cart-response.dto';

@ApiTags('Cart')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @ApiOperation({ summary: 'Get my cart' })
  @ApiOkResponse({ type: CartResponseDto })
  @Get()
  getCart(@CurrentUser() user: any) {
    return this.cartService.getCart(user.userId);
  }

  @ApiOperation({
    summary: 'Add an item to my cart',
    description:
      'Returns 409 if the cart already holds items from a different restaurant; resubmit with replaceExisting: true to clear the cart and add the new item instead.',
  })
  @ApiOkResponse({ type: CartResponseDto })
  @Post('items')
  addItem(@CurrentUser() user: any, @Body() dto: AddCartItemDto) {
    return this.cartService.addItem(user.userId, dto);
  }

  @ApiOperation({ summary: 'Update a cart item quantity' })
  @ApiParam({ name: 'itemId' })
  @ApiOkResponse({ type: CartResponseDto })
  @Patch('items/:itemId')
  updateItem(
    @CurrentUser() user: any,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItemQuantity(user.userId, itemId, dto);
  }

  @ApiOperation({ summary: 'Remove an item from my cart' })
  @ApiParam({ name: 'itemId' })
  @ApiOkResponse({ type: CartResponseDto })
  @Delete('items/:itemId')
  removeItem(@CurrentUser() user: any, @Param('itemId') itemId: string) {
    return this.cartService.removeItem(user.userId, itemId);
  }

  @ApiOperation({ summary: 'Clear my cart' })
  @ApiOkResponse({ type: CartResponseDto })
  @Delete()
  clearCart(@CurrentUser() user: any) {
    return this.cartService.clearCart(user.userId);
  }
}
