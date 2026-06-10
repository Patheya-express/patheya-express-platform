import {
  Injectable,
} from '@nestjs/common';

import { PrismaService }
from '../../../infrastructure/database/prisma.service';

import {
  BaseRepository,
} from '../../../infrastructure/database/repositories/base.repository';

@Injectable()
export class DeliveryRepository
  extends BaseRepository {

  constructor(
    prisma: PrismaService,
  ) {

    super(prisma);

  }

  async createDeliveryPartner(
    data: any,
  ) {

    return this.prisma
      .deliveryPartner
      .create({

        data,

      });

  }

  async findPartnerByUserId(
    userId: string,
  ) {

    return this.prisma
      .deliveryPartner
      .findUnique({

        where: {
          userId,
        },

      });

  }

  async updatePartnerStatus(

    userId: string,

    status: any,

  ) {

    return this.prisma
      .deliveryPartner
      .update({

        where: {
          userId,
        },

        data: {
          status,
        },

      });

  }

  async getAssignedOrders(
    userId: string,
  ) {

    return this.prisma.order
      .findMany({

        where: {
          deliveryPartnerId:
            userId,
        },

        include: {

          restaurant: true,

          items: true,

        },

      });

  }

  async findOrderById(
    orderId: string,
  ) {

    return this.prisma.order
      .findUnique({

        where: {
          id: orderId,
        },

      });

  }

  async findOrderByIdForPartner(

    orderId: string,

    userId: string,

  ) {

    return this.prisma.order
      .findFirst({

        where: {

          id: orderId,

          deliveryPartnerId:
            userId,

        },

      });

  }

  async updateOrderStatus(

    orderId: string,

    status: any,

  ) {

    return this.prisma.order
      .update({

        where: {
          id: orderId,
        },

        data: {
          status,
        },

      });

  }

}