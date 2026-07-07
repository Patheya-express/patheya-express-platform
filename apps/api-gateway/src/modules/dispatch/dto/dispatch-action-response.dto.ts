import { ApiProperty } from '@nestjs/swagger';

export class DispatchActionResponseDto {
  @ApiProperty({
    example: true,
  })
  success: boolean;
}
