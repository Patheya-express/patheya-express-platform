import { ApiProperty } from '@nestjs/swagger';

import { DeliveryProofType } from '@prisma/client';

export class ProofPhotoResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderId: string;

  @ApiProperty({ enum: DeliveryProofType })
  type: DeliveryProofType;

  @ApiProperty()
  storageUrl: string;

  @ApiProperty()
  fileName: string;

  @ApiProperty()
  mimeType: string;

  @ApiProperty()
  sizeBytes: number;

  @ApiProperty()
  uploadedById: string;

  @ApiProperty()
  createdAt: Date;
}
