import { ApiProperty } from '@nestjs/swagger';

export class RecentSearchDto {
  @ApiProperty() id: string;
  @ApiProperty() query: string;
  @ApiProperty() updatedAt: Date;
}
