import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { DeliveryPartnerStatus, VehicleType } from '@prisma/client';

class AvailablePartnerCurrentAssignmentDto {
  @ApiProperty()
  orderId: string;

  @ApiProperty()
  orderNumber: string;

  @ApiProperty()
  restaurantName: string;
}

class AvailablePartnerLocationDto {
  @ApiPropertyOptional()
  latitude?: number;

  @ApiPropertyOptional()
  longitude?: number;
}

/** Response shape for `GET /admin/delivery-partners/available` — exactly the fields Phase 9
 *  asks for. Deliberately its own DTO rather than reusing AdminDeliveryPartnerResponseDto
 *  (the existing `GET /delivery/admin` contract) so that endpoint's shape never has to change. */
export class AvailableDeliveryPartnerResponseDto {
  @ApiProperty({
    description:
      "The DeliveryPartner's own id — pass this as deliveryPartnerId to POST /admin/orders/:orderId/assign.",
  })
  partnerId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  phone?: string;

  @ApiProperty({ enum: VehicleType })
  vehicle: VehicleType;

  @ApiProperty({ enum: DeliveryPartnerStatus })
  status: DeliveryPartnerStatus;

  @ApiProperty({
    type: AvailablePartnerCurrentAssignmentDto,
    isArray: true,
    description:
      "The partner's current non-terminal order, if any — modeled as an array for forward compatibility, though this domain only ever has at most one.",
  })
  currentAssignments: AvailablePartnerCurrentAssignmentDto[];

  @ApiProperty({
    description:
      'Live Redis presence — distinct from `status`, the durable DB flag.',
  })
  online: boolean;

  @ApiProperty({ type: AvailablePartnerLocationDto })
  location: AvailablePartnerLocationDto;
}
