import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { RestaurantMediaType } from '@prisma/client';

export class MediaResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() restaurantId: string;
  @ApiPropertyOptional() branchId?: string;
  @ApiProperty({ enum: RestaurantMediaType }) type: RestaurantMediaType;
  @ApiProperty() url: string;
  @ApiProperty() sortOrder: number;
  @ApiProperty() uploadedById: string;
  @ApiProperty() createdAt: Date;
}
