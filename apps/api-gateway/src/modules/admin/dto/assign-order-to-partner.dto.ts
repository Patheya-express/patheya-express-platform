import { ApiProperty } from '@nestjs/swagger';

import { IsNotEmpty, IsString } from 'class-validator';

export class AssignOrderToPartnerDto {
  @ApiProperty({
    description:
      "The target delivery partner's own id (DeliveryPartner.id — the same `partnerId` returned by GET /admin/delivery-partners/available).",
  })
  @IsString()
  @IsNotEmpty()
  deliveryPartnerId: string;
}
