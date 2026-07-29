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
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
import { GetRestaurantReviewsQueryDto } from '../dto/get-restaurant-reviews-query.dto';
import { PaginatedReviewsResponseDto } from '../dto/paginated-reviews-response.dto';
import { ReplyDto } from '../dto/reply-dto';
import { RatingSummaryResponseDto } from '../dto/rating-summary-response.dto';

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
    summary: "Get a restaurant's reviews for management",
    description:
      'Every review for the restaurant, with rating/date/hasReply filters the public listing does not support. Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({ name: 'id' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'rating', required: false, type: Number })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'hasReply', required: false, type: Boolean })
  @ApiOkResponse({
    description: 'Reviews retrieved successfully',
    type: PaginatedReviewsResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Caller does not manage this restaurant',
  })
  @UseGuards(JwtAuthGuard)
  @Get(':id/reviews/manage')
  getReviewsForManage(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,

    @Query()
    query: GetRestaurantReviewsQueryDto,
  ) {
    return this.reviewsService.getReviewsForManage(id, query, user);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: "Get a restaurant's rating summary",
    description:
      'Average rating, total review count, and a per-star (1-5) breakdown. Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({
    description: 'Rating summary retrieved successfully',
    type: RatingSummaryResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Caller does not manage this restaurant',
  })
  @UseGuards(JwtAuthGuard)
  @Get(':id/reviews/manage/summary')
  getRatingSummary(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,
  ) {
    return this.reviewsService.getRatingSummary(id, user);
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

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Reply to a review',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only. Fails if a reply already exists — use update instead. The reviewing customer is notified.',
  })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'reviewId' })
  @ApiCreatedResponse({
    description: 'Reply posted successfully',
    type: ReviewResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'This review already has a reply',
  })
  @ApiForbiddenResponse({
    description: 'Caller does not manage this restaurant',
  })
  @UseGuards(JwtAuthGuard)
  @Post(':id/reviews/:reviewId/reply')
  createReply(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,

    @Param('reviewId')
    reviewId: string,

    @Body()
    dto: ReplyDto,
  ) {
    return this.reviewsService.createReply(id, reviewId, dto, user);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Edit a reply',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only. Fails if no reply exists yet — use create instead.',
  })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'reviewId' })
  @ApiOkResponse({
    description: 'Reply updated successfully',
    type: ReviewResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Review not found, or has no reply yet',
  })
  @ApiForbiddenResponse({
    description: 'Caller does not manage this restaurant',
  })
  @UseGuards(JwtAuthGuard)
  @Patch(':id/reviews/:reviewId/reply')
  updateReply(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,

    @Param('reviewId')
    reviewId: string,

    @Body()
    dto: ReplyDto,
  ) {
    return this.reviewsService.updateReply(id, reviewId, dto, user);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Delete a reply',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only. The underlying customer review is never affected.',
  })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'reviewId' })
  @ApiOkResponse({
    description: 'Reply deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Review not found, or has no reply to delete',
  })
  @ApiForbiddenResponse({
    description: 'Caller does not manage this restaurant',
  })
  @UseGuards(JwtAuthGuard)
  @Delete(':id/reviews/:reviewId/reply')
  deleteReply(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,

    @Param('reviewId')
    reviewId: string,
  ) {
    return this.reviewsService.deleteReply(id, reviewId, user);
  }
}
