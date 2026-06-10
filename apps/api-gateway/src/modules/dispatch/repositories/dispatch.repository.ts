import {
    Injectable,
  } from '@nestjs/common';
  
  import { PrismaService }
  from '../../../infrastructure/database/prisma.service';
  
  import {
    AssignmentStatus,
    DeliveryPartnerStatus,
  } from '@prisma/client';
  
  @Injectable()
  export class DispatchRepository {
  
    constructor(
      private readonly prisma:
        PrismaService,
    ) {}
  
    async createAssignment(
      data: any,
    ) {
  
      return this.prisma
        .deliveryAssignment
        .create({
  
          data,
  
        });
  
    }
  
    async findAssignmentById(
      assignmentId: string,
    ) {
  
      return this.prisma
        .deliveryAssignment
        .findUnique({
  
          where: {
            id: assignmentId,
          },
  
        });
  
    }
  
    async updateAssignmentStatus(
  
      assignmentId: string,
  
      status: AssignmentStatus,
  
    ) {
  
      return this.prisma
        .deliveryAssignment
        .update({
  
          where: {
            id: assignmentId,
          },
  
          data: {
  
            status,
  
            respondedAt:
              new Date(),
  
          },
  
        });
  
    }
  
    async findAvailablePartners() {
  
      return this.prisma
        .deliveryPartner
        .findMany({
  
          where: {
  
            status:
              DeliveryPartnerStatus
                .AVAILABLE,
  
            isVerified:
              true,
  
          },
  
          include: {
  
            user: true,
  
          },
  
        });
  
    }
  
    async findPartnerAssignments(
      partnerId: string,
    ) {
  
      return this.prisma
        .deliveryAssignment
        .findMany({
  
          where: {
  
            deliveryPartnerId:
              partnerId,
  
          },
  
          include: {
  
            order: true,
  
          },
  
          orderBy: {
  
            createdAt:
              'desc',
  
          },
  
        });
  
    }
  
  }