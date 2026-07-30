import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateMenuItemVariantDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
