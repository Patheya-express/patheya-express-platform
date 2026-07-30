import { Injectable } from '@nestjs/common';

import { CuisinesRepository } from '../repositories/cuisines.repository';
import { CuisineResponseDto } from '../dto/cuisine-response.dto';

@Injectable()
export class CuisinesService {
  constructor(private readonly cuisinesRepository: CuisinesRepository) {}

  async findAll(search?: string): Promise<CuisineResponseDto[]> {
    return this.cuisinesRepository.findAll(search);
  }
}
