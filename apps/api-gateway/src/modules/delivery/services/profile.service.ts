import { Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction } from '@prisma/client';

import { DeliveryRepository } from '../repositories/delivery.repository';

import { UpdateDeliveryProfileDto } from '../dto/update-delivery-profile.dto';

import { AuditService } from '../../audit/services/audit.service';

@Injectable()
export class ProfileService {
  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly auditService: AuditService,
  ) {}

  async getMyProfile(userId: string) {
    const partner = await this.deliveryRepository.findPartnerByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    return partner;
  }

  async updateMyProfile(userId: string, dto: UpdateDeliveryProfileDto) {
    await this.getMyProfile(userId);

    const updated = await this.deliveryRepository.updateProfile(userId, {
      ...dto,
    });

    await this.auditService.log(
      userId,
      'DeliveryPartner',
      updated.id,
      AuditAction.UPDATE,
      null,
      { fieldsUpdated: Object.keys(dto) },
    );

    return updated;
  }
}
