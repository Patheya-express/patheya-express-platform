import {
    Injectable,
  } from '@nestjs/common';
  
  import { PrismaService }
  from '../../../infrastructure/database/prisma.service';
  
  import {
    BaseRepository,
  } from '../../../infrastructure/database/repositories/base.repository';
  
  @Injectable()
  export class UsersRepository
    extends BaseRepository {
  
    constructor(
      prisma: PrismaService,
    ) {
  
      super(prisma);
  
    }
  
    async findById(
      userId: string,
    ) {
  
      return this.prisma.user.findUnique({
  
        where: {
          id: userId,
        },
  
      });
  
    }
  
    async updateProfile(
  
      userId: string,
  
      data: any,
  
    ) {
  
      return this.prisma.user.update({
  
        where: {
          id: userId,
        },
  
        data,
  
      });
  
    }
  
    async findAllUsers(
  
      skip: number,
  
      take: number,
  
    ) {
  
      return this.prisma.user.findMany({
  
        skip,
  
        take,
  
        orderBy: {
          createdAt: 'desc',
        },
  
      });
  
    }
  
  }