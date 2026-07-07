import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

import { ApiPropertyOptional } from '@nestjs/swagger';

export class RefundOrderDto {
  @ApiPropertyOptional({
    description: 'Amount to refund. Defaults to the full payment amount when omitted.',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
