import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReportColumnResponseDto {
  @ApiProperty()
  key: string;

  @ApiProperty()
  label: string;
}

export class ReportSummaryEntryResponseDto {
  @ApiProperty()
  label: string;

  @ApiProperty()
  value: string | number;
}

/** The `format=json` shape — a preview of exactly what the CSV/Excel/PDF export would contain. */
export class ReportResponseDto {
  @ApiProperty()
  title: string;

  @ApiProperty()
  generatedAt: Date;

  @ApiProperty({ type: [ReportColumnResponseDto] })
  columns: ReportColumnResponseDto[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: "One object per row, keyed by each column's `key`.",
  })
  rows: Record<string, string | number | null>[];

  @ApiPropertyOptional({ type: [ReportSummaryEntryResponseDto] })
  summary?: ReportSummaryEntryResponseDto[];
}
