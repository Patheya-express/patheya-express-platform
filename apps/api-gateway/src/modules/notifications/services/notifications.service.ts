import {
    Injectable,
  } from '@nestjs/common';
  
  import {
    NotificationChannel,
  } from '@prisma/client';
  
  import { NotificationsRepository }
  from '../repositories/notifications.repository';
  
  @Injectable()
  export class NotificationsService {
  
    constructor(
  
      private readonly notificationsRepository:
        NotificationsRepository,
  
    ) {}
  
    async createNotification(
  
      userId: string,
  
      title: string,
  
      message: string,
  
      metadata?: any,
  
    ) {
  
      return this.notificationsRepository
        .createNotification({
  
          userId,
  
          title,
  
          message,
  
          metadata,
  
          channel:
            NotificationChannel.IN_APP,
  
        });
  
    }
  
    async getMyNotifications(
      userId: string,
    ) {
  
      return this.notificationsRepository
        .findUserNotifications(
          userId,
        );
  
    }
  
    async markAsRead(
      notificationId: string,
    ) {
  
      return this.notificationsRepository
        .markAsRead(
          notificationId,
        );
  
    }
  
    async registerPushToken(
  
      userId: string,
  
      token: string,
  
      platform: string,
  
    ) {
  
      return this.notificationsRepository
        .savePushToken({
  
          userId,
  
          token,
  
          platform,
  
        });
  
    }
  
  }