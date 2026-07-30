import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { Type } from 'class-transformer';

import { TicketCategory, TicketStatus } from '@prisma/client';

export class GetTicketsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;
}
