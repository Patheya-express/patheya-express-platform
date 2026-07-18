import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { AssignmentStatus, DeliveryPartnerStatus } from '@prisma/client';

@Injectable()
export class DispatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createAssignment(data: any) {
    return this.prisma.deliveryAssignment.create({
      data,
    });
  }
  async assignOrderToPartner(
    orderId: string,

    userId: string,
  ) {
    return this.prisma.order.update({
      where: {
        id: orderId,
      },

      data: {
        deliveryPartnerId: userId,
      },
    });
  }

  async findAssignmentById(assignmentId: string) {
    return this.prisma.deliveryAssignment.findUnique({
      where: {
        id: assignmentId,
      },
    });
  }

  async updateAssignmentStatus(
    assignmentId: string,

    status: AssignmentStatus,
  ) {
    return this.prisma.deliveryAssignment.update({
      where: {
        id: assignmentId,
      },

      data: {
        status,

        respondedAt: new Date(),
      },
    });
  }

  async findAvailablePartners() {
    return this.prisma.deliveryPartner.findMany({
      where: {
        status: DeliveryPartnerStatus.AVAILABLE,

        isVerified: true,
      },

      include: {
        user: true,
      },
    });
  }

  /** `status` is optional — omitted, returns every assignment for the partner (unchanged,
   *  pre-existing behavior); passed, narrows to that one AssignmentStatus (additive). */
  async findPartnerAssignments(partnerId: string, status?: AssignmentStatus) {
    return this.prisma.deliveryAssignment.findMany({
      where: {
        deliveryPartnerId: partnerId,

        ...(status ? { status } : {}),
      },

      include: {
        order: {
          include: {
            customer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
              },
            },

            restaurant: {
              select: {
                id: true,
                name: true,
                phone: true,
              },
            },

            branch: {
              select: {
                addressLine1: true,
                addressLine2: true,
                city: true,
                state: true,
                postalCode: true,
                latitude: true,
                longitude: true,
              },
            },

            items: {
              include: {
                menuItem: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },

      orderBy: {
        createdAt: 'desc',
      },
    });
  }
  async findPartnerByUserId(userId: string) {
    return this.prisma.deliveryPartner.findUnique({
      where: {
        userId,
      },
    });
  }

  /** By the DeliveryPartner's own primary key (as stored on DeliveryAssignment.deliveryPartnerId)
   *  — distinct from findPartnerByUserId, which looks up by the associated User's id instead. */
  async findPartnerById(id: string) {
    return this.prisma.deliveryPartner.findUnique({
      where: {
        id,
      },
    });
  }
  async findActiveAssignmentForOrder(orderId: string) {
    return this.prisma.deliveryAssignment.findFirst({
      where: {
        orderId,

        status: {
          in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED],
        },
      },
    });
  }

  /** Any PENDING/ACCEPTED assignment for this partner, regardless of which order — used by
   *  manual admin assignment to reject "already assigned partners" (a partner mid-assignment
   *  elsewhere shouldn't be double-booked by an admin override). */
  async findActiveAssignmentForPartner(deliveryPartnerId: string) {
    return this.prisma.deliveryAssignment.findFirst({
      where: {
        deliveryPartnerId,

        status: {
          in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED],
        },
      },
    });
  }

  async findAssignmentsForOrder(orderId: string) {
    return this.prisma.deliveryAssignment.findMany({
      where: {
        orderId,
      },

      select: {
        deliveryPartnerId: true,
        status: true,
      },
    });
  }
  async findOrderById(orderId: string) {
    return this.prisma.order.findUnique({
      where: {
        id: orderId,
      },
    });
  }
}
