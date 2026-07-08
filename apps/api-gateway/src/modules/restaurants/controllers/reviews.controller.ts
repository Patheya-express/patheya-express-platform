import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { ReviewsService } from '../services/reviews.service';
import { CreateReviewDto } from '../dto/create-review.dto';
import { ReviewResponseDto } from '../dto/review-response.dto';
import { GetReviewsQueryDto } from '../dto/get-reviews-query.dto';
import { PaginatedReviewsResponseDto } from '../dto/paginated-reviews-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Restaurants')
@Controller('restaurants')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @ApiOperation({
    summary: 'List reviews for a restaurant',
    description: 'Public — paginated, newest first.',
  })
  @ApiParam({ name: 'id' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({
    description: 'Reviews retrieved successfully',
    type: PaginatedReviewsResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Restaurant not found',
  })
  @Get(':id/reviews')
  getReviews(
    @Param('id')
    id: string,

    @Query()
    query: GetReviewsQueryDto,
  ) {
    return this.reviewsService.getReviews(id, query);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get my review for a restaurant',
    description:
      'Returns null if the current customer has not reviewed this restaurant.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({
    description: "Current customer's review, or null",
    type: ReviewResponseDto,
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  @Get(':id/reviews/me')
  getMyReview(
    @Param('id')
    id: string,

    @CurrentUser()
    user: any,
  ) {
    return this.reviewsService.getMyReview(id, user.userId);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Rate a restaurant',
    description:
      "Submits (or updates) the current customer's rating and review for a restaurant, and recomputes the restaurant's aggregated rating. Requires at least one DELIVERED order from this restaurant.",
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    description: 'Review submitted successfully',
    type: ReviewResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Customer has no delivered order from this restaurant',
  })
  @ApiResponse({
    status: 404,
    description: 'Restaurant not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  @Post(':id/reviews')
  createReview(
    @Param('id')
    id: string,

    @CurrentUser()
    user: any,

    @Body()
    dto: CreateReviewDto,
  ) {
    return this.reviewsService.createReview(id, user.userId, dto);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Delete my review for a restaurant',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({
    description: 'Review deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Review not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  @Delete(':id/reviews')
  deleteReview(
    @Param('id')
    id: string,

    @CurrentUser()
    user: any,
  ) {
    return this.reviewsService.deleteReview(id, user.userId);
  }
}
