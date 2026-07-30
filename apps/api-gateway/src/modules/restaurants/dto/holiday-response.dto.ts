import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HolidayResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() restaurantId: string;
  @ApiPropertyOptional() branchId?: string;
  @ApiProperty() date: Date;
  @ApiProperty() name: string;
  @ApiProperty() isClosed: boolean;
  @ApiPropertyOptional() specialOpensAt?: string;
  @ApiPropertyOptional() specialClosesAt?: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
