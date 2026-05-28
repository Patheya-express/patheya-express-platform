import {
    Module,
  } from '@nestjs/common';
  
  import { RestaurantsController }
  from './controllers/restaurants.controller';
  
  import { RestaurantsService }
  from './services/restaurants.service';
  
  import { RestaurantsRepository }
  from './repositories/restaurants.repository';
  
  @Module({
  
    controllers: [
      RestaurantsController,
    ],
  
    providers: [
  
      RestaurantsService,
  
      RestaurantsRepository,
  
    ],
  
  })
  export class RestaurantsModule {}