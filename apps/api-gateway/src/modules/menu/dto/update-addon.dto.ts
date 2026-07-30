import { IsInt, IsOptional, IsString } from 'class-validator';

export class UpdateAddonDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  minSelection?: number;

  @IsOptional()
  @IsInt()
  maxSelection?: number;
}
