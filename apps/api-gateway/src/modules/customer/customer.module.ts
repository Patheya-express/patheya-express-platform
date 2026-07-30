import { Module } from '@nestjs/common';

import { RestaurantsModule } from '../restaurants/restaurants.module';
import { OffersModule } from '../offers/offers.module';

import { CustomerHomeController } from './controllers/customer-home.controller';

import { CustomerHomeService } from './services/customer-home.service';

@Module({
  imports: [RestaurantsModule, OffersModule],

  controllers: [CustomerHomeController],

  providers: [CustomerHomeService],
})
export class CustomerModule {}
