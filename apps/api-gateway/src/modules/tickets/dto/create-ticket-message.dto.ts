import { IsString, MinLength } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class CreateTicketMessageDto {
  @ApiProperty({ example: "It's still an issue, can someone help?" })
  @IsString()
  @MinLength(1)
  message: string;
}
