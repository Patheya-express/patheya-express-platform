import { ApiProperty } from '@nestjs/swagger';

/** Liveness has no dependency checks by design — it only confirms the process itself is up and
 *  responding, so an orchestrator doesn't restart a healthy process just because a downstream
 *  dependency (DB/Redis) is temporarily unavailable. Use /health/ready for that. */
export class LivenessResponseDto {
  @ApiProperty({
    example: 'ok',
  })
  status: string;

  @ApiProperty({
    example: 12345,
    description: 'Process uptime in seconds',
  })
  uptime: number;

  @ApiProperty({
    example: '2026-07-04T10:00:00.000Z',
  })
  timestamp: string;
}
