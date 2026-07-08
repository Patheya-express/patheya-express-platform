import { IsBoolean, IsOptional } from 'class-validator';

import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePreferencesDto {
  @ApiPropertyOptional({ description: 'Order status update emails' })
  @IsOptional()
  @IsBoolean()
  orderUpdatesEmail?: boolean;

  @ApiPropertyOptional({ description: 'Order status update SMS' })
  @IsOptional()
  @IsBoolean()
  orderUpdatesSms?: boolean;

  @ApiPropertyOptional({
    description: 'Order status update push notifications',
  })
  @IsOptional()
  @IsBoolean()
  orderUpdatesPush?: boolean;

  @ApiPropertyOptional({ description: 'Promotional emails' })
  @IsOptional()
  @IsBoolean()
  promotionsEmail?: boolean;

  @ApiPropertyOptional({ description: 'Promotional SMS' })
  @IsOptional()
  @IsBoolean()
  promotionsSms?: boolean;

  @ApiPropertyOptional({ description: 'Promotional push notifications' })
  @IsOptional()
  @IsBoolean()
  promotionsPush?: boolean;

  @ApiPropertyOptional({ description: 'Review-related emails' })
  @IsOptional()
  @IsBoolean()
  reviewsEmail?: boolean;

  @ApiPropertyOptional({ description: 'Review-related SMS' })
  @IsOptional()
  @IsBoolean()
  reviewsSms?: boolean;

  @ApiPropertyOptional({ description: 'Review-related push notifications' })
  @IsOptional()
  @IsBoolean()
  reviewsPush?: boolean;

  @ApiPropertyOptional({ description: 'System/account emails' })
  @IsOptional()
  @IsBoolean()
  systemEmail?: boolean;

  @ApiPropertyOptional({ description: 'System/account SMS' })
  @IsOptional()
  @IsBoolean()
  systemSms?: boolean;

  @ApiPropertyOptional({ description: 'System/account push notifications' })
  @IsOptional()
  @IsBoolean()
  systemPush?: boolean;
}
