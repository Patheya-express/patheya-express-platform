import { IsEnum, IsOptional } from 'class-validator';

import { AssignmentStatus } from '@prisma/client';

/** Optional, additive filter for `GET /dispatch/assignments` — omitted, the endpoint returns
 *  every assignment for the caller exactly as it always has. */
export class GetDispatchAssignmentsQueryDto {
  @IsOptional()
  @IsEnum(AssignmentStatus)
  status?: AssignmentStatus;
}
