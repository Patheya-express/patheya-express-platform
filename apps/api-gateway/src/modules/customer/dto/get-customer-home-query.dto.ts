import { IsLatitude, IsLongitude, IsOptional } from 'class-validator';

import { Type } from 'class-transformer';

export class GetCustomerHomeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;
}
