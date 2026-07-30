import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { VerificationStatus } from '@prisma/client';

/** Never exposes the full account number — only the last-4 masked display value. */
export class DeliveryBankAccountResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() deliveryPartnerId: string;
  @ApiProperty() accountHolderName: string;
  @ApiProperty() bankName: string;
  @ApiPropertyOptional() branchName?: string;
  @ApiProperty({ example: '••••6023' }) accountNumberLast4: string;
  @ApiProperty() ifsc: string;
  @ApiPropertyOptional() upiId?: string;
  @ApiPropertyOptional() cancelledChequeDocumentId?: string;
  @ApiProperty({ enum: VerificationStatus })
  verificationStatus: VerificationStatus;
  @ApiPropertyOptional() verifiedAt?: Date;
  @ApiPropertyOptional() payoutProviderRef?: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
