import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BranchResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() restaurantId: string;
  @ApiProperty() name: string;
  @ApiProperty() addressLine1: string;
  @ApiPropertyOptional() addressLine2?: string;
  @ApiPropertyOptional() landmark?: string;
  @ApiProperty() city: string;
  @ApiProperty() state: string;
  @ApiProperty() postalCode: string;
  @ApiPropertyOptional() latitude?: number;
  @ApiPropertyOptional() longitude?: number;
  @ApiPropertyOptional() timezone?: string;
  @ApiPropertyOptional() deliveryRadiusKm?: number;
  @ApiPropertyOptional() phone?: string;
  @ApiPropertyOptional() emergencyContactName?: string;
  @ApiPropertyOptional() emergencyContactPhone?: string;
  @ApiProperty() isActive: boolean;
  @ApiProperty() isPrimary: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
