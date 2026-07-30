import { IsOptional, IsString } from 'class-validator';

import { ApiPropertyOptional } from '@nestjs/swagger';

export class AssignTicketDto {
  @ApiPropertyOptional({
    description: 'Agent to assign. Omit to self-assign as the calling agent.',
  })
  @IsOptional()
  @IsString()
  agentId?: string;
}
