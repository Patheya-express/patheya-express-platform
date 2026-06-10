import {
    Injectable,
  } from '@nestjs/common';
  
  import { PrismaService }
  from '../../../infrastructure/database/prisma.service';
  
  @Injectable()
  export class NotificationsRepository {
  
    constructor(
      private readonly prisma:
        PrismaService,
    ) {}
  
    async createNotification(
      data: any,
    ) {
  
      return this.prisma.notification.create({
        data,
      });
  
    }
  
    async findUserNotifications(
      userId: string,
    ) {
  
      return this.prisma.notification.findMany({
  
        where: {
          userId,
        },
  
        orderBy: {
          createdAt: 'desc',
        },
  
      });
  
    }
  
    async markAsRead(
      notificationId: string,
    ) {
  
      return this.prisma.notification.update({
  
        where: {
          id: notificationId,
        },
  
        data: {
  
          status: 'READ',
  
          readAt:
            new Date(),
  
        },
  
      });
  
    }
  
    async savePushToken(
      data: any,
    ) {
  
      return this.prisma.pushToken.upsert({
  
        where: {
          token: data.token,
        },
  
        update: {
          platform:
            data.platform,
        },
  
        create: data,
  
      });
  
    }
  
  }