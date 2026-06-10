import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import {
  DeliveryPartnerStatus,
  OrderStatus,
} from '@prisma/client';

import { DeliveryRepository }
from '../repositories/delivery.repository';

import { CreateDeliveryPartnerDto }
from '../dto/create-delivery-partner.dto';

import { UpdateDeliveryStatusDto }
from '../dto/update-delivery-status.dto';

@Injectable()
export class DeliveryService {

  constructor(

    private readonly deliveryRepository:
      DeliveryRepository,

  ) {}

  async onboardPartner(

    userId: string,

    dto: CreateDeliveryPartnerDto,

  ) {

    const existingPartner =

      await this.deliveryRepository
        .findPartnerByUserId(
          userId,
        );

    if (existingPartner) {

      throw new ConflictException(
        'Delivery partner already exists',
      );

    }

    return this.deliveryRepository
      .createDeliveryPartner({

        userId,

        vehicleType:
          dto.vehicleType,

        vehicleNumber:
          dto.vehicleNumber,

        licenseNumber:
          dto.licenseNumber,

      });

  }

  async goAvailable(
    userId: string,
  ) {

    return this.deliveryRepository
      .updatePartnerStatus(

        userId,

        DeliveryPartnerStatus
          .AVAILABLE,

      );

  }

  async goOffline(
    userId: string,
  ) {

    return this.deliveryRepository
      .updatePartnerStatus(

        userId,

        DeliveryPartnerStatus
          .OFFLINE,

      );

  }

  async getAssignedOrders(
    userId: string,
  ) {

    return this.deliveryRepository
      .getAssignedOrders(
        userId,
      );

  }

  async updateDeliveryStatus(

    orderId: string,

    userId: string,

    dto: UpdateDeliveryStatusDto,

  ) {

    const order =

      await this.deliveryRepository
        .findOrderByIdForPartner(

          orderId,

          userId,

        );

    if (!order) {

      throw new NotFoundException(
        'Order not assigned to you',
      );

    }

    const allowedTransitions = {

      [OrderStatus.READY_FOR_PICKUP]: [
        OrderStatus.OUT_FOR_DELIVERY,
      ],

      [OrderStatus.OUT_FOR_DELIVERY]: [
        OrderStatus.DELIVERED,
      ],

      [OrderStatus.DELIVERED]: [],

    };

    const validStatuses =

      allowedTransitions[
        order.status
      ] || [];

    if (

      !validStatuses.includes(
        dto.status,
      )

    ) {

      throw new ConflictException(

        `Invalid status transition from ${order.status} to ${dto.status}`,

      );

    }

    return this.deliveryRepository
      .updateOrderStatus(

        orderId,

        dto.status,

      );

  }

}