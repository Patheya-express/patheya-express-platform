import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  restaurantId: string;

  @ApiProperty()
  customerId: string;

  @ApiPropertyOptional({
    description: "The reviewing customer's display name",
    example: 'Priya S.',
  })
  customerName?: string;

  @ApiProperty({
    example: 5,
  })
  rating: number;

  @ApiPropertyOptional()
  comment?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({
    description: 'The restaurant owner/manager reply, if one has been posted.',
  })
  replyText?: string;

  @ApiPropertyOptional()
  replyCreatedAt?: Date;

  @ApiPropertyOptional()
  replyUpdatedAt?: Date;
}
