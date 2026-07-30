import { ApiProperty } from '@nestjs/swagger';

export class OperatingHourResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: '0 (Sunday) through 6 (Saturday)', example: 1 })
  dayOfWeek: number;

  @ApiProperty({ example: '09:00' })
  opensAt: string;

  @ApiProperty({ example: '22:00' })
  closesAt: string;

  @ApiProperty()
  isClosed: boolean;
}
