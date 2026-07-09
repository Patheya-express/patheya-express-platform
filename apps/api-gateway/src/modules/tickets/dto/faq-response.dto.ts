import { ApiProperty } from '@nestjs/swagger';

export class FaqResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() category: string;
  @ApiProperty() question: string;
  @ApiProperty() answer: string;
}
