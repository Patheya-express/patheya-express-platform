import {
    Injectable,
    NotFoundException,
  } from '@nestjs/common';
  
  import { UsersRepository }
  from '../repositories/users.repository';
  
  import { UpdateProfileDto }
  from '../dto/update-profile.dto';
  
  @Injectable()
  export class UsersService {
  
    constructor(
  
      private readonly usersRepository:
        UsersRepository,
  
    ) {}
  
    async getProfile(
      userId: string,
    ) {
  
      const user =
  
        await this.usersRepository
          .findById(userId);
  
      if (!user) {
  
        throw new NotFoundException(
          'User not found',
        );
  
      }
  
      const {
  
        passwordHash,
  
        ...safeUser
  
      } = user;
  
      return safeUser;
  
    }
  
    async updateProfile(
  
      userId: string,
  
      dto: UpdateProfileDto,
  
    ) {
  
      const updatedUser =
  
        await this.usersRepository
          .updateProfile(
  
            userId,
  
            dto,
  
          );
  
      const {
  
        passwordHash,
  
        ...safeUser
  
      } = updatedUser;
  
      return safeUser;
  
    }
  
    async getAllUsers(
  
      page = 1,
  
      limit = 20,
  
    ) {
  
      const skip =
        (page - 1) * limit;
  
      const users =
  
        await this.usersRepository
          .findAllUsers(
  
            skip,
  
            limit,
  
          );
  
      return users.map((user) => {
  
        const {
  
          passwordHash,
  
          ...safeUser
  
        } = user;
  
        return safeUser;
  
      });
  
    }
  
  }