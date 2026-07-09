import { IsEnum } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

import { TicketPriority } from '@prisma/client';

export class UpdateTicketPriorityDto {
  @ApiProperty({ enum: TicketPriority })
  @IsEnum(TicketPriority)
  priority: TicketPriority;
}
