import { Module } from '@nestjs/common';

import { OffersController } from './controllers/offers.controller';

import { OffersService } from './services/offers.service';

import { OffersRepository } from './repositories/offers.repository';

@Module({
  controllers: [OffersController],

  providers: [OffersService, OffersRepository],

  exports: [OffersService],
})
export class OffersModule {}
