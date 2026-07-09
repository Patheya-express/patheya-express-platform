import { ApiProperty } from '@nestjs/swagger';

export class TrendingSearchDto {
  @ApiProperty() query: string;
  @ApiProperty() score: number;
}
