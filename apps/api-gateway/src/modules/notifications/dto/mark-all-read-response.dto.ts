import { ApiProperty } from '@nestjs/swagger';

export class MarkAllReadResponseDto {
  @ApiProperty({
    example: 5,
    description: 'Number of notifications that were marked as read.',
  })
  updatedCount: number;
}
