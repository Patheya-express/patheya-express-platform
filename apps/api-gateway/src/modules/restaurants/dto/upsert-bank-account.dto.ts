import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class UpsertBankAccountDto {
  @ApiProperty({ example: 'Patheya Foods Private Limited' })
  @IsString()
  accountHolderName: string;

  @ApiProperty({ example: 'HDFC Bank' })
  @IsString()
  bankName: string;

  @ApiPropertyOptional({ example: 'Koramangala Branch' })
  @IsOptional()
  @IsString()
  branchName?: string;

  @ApiProperty({
    example: '50100123456789',
    description:
      'Stored encrypted at rest — only the last 4 digits are ever returned by the API.',
  })
  @IsString()
  @MinLength(6)
  accountNumber: string;

  @ApiProperty({ example: 'HDFC0000123' })
  @IsString()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, {
    message: 'ifsc must be a valid IFSC code',
  })
  ifsc: string;

  @ApiPropertyOptional({ example: 'patheyaexpress@hdfcbank' })
  @IsOptional()
  @IsString()
  upiId?: string;

  @ApiPropertyOptional({
    description:
      'Id of the RestaurantDocument row holding the uploaded cancelled cheque.',
  })
  @IsOptional()
  @IsString()
  cancelledChequeDocumentId?: string;
}
