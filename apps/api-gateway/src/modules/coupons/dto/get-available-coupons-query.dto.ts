import { IsOptional, IsString } from 'class-validator';

export class GetAvailableCouponsQueryDto {
  @IsOptional()
  @IsString()
  restaurantId?: string;
}
