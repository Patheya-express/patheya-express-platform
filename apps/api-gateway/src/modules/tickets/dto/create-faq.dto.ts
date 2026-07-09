import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFaqDto {
  @ApiProperty({ example: 'Orders' })
  @IsString()
  @MinLength(1)
  category: string;

  @ApiProperty({ example: 'How do I cancel my order?' })
  @IsString()
  @MinLength(1)
  question: string;

  @ApiProperty({
    example:
      "You can cancel from Order Details as long as the restaurant hasn't started preparing it.",
  })
  @IsString()
  @MinLength(1)
  answer: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
