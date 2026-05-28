import { Module }
from '@nestjs/common';

import {
  ConfigModule,
} from '@nestjs/config';

import configuration
from './config/configuration';

import {
  envValidationSchema,
} from './config/env.validation';

import { PrismaModule }
from './infrastructure/database/prisma.module';

import { HealthModule }
from './modules/health/health.module';

import { LoggerModule }
from './infrastructure/logger/logger.module';

import { AuthModule }
from './modules/auth/auth.module';

import { UsersModule }
from './modules/users/users.module';

import { RestaurantsModule }
from './modules/restaurants/restaurants.module';

import { MenuModule } from './modules/menu/menu.module';
import { OrdersModule } from './modules/orders/orders.module';
import { DeliveryModule } from './modules/delivery/delivery.module';

@Module({

  imports: [

    ConfigModule.forRoot({

      isGlobal: true,

      load: [
        configuration,
      ],

      validationSchema:
        envValidationSchema,

    }),

    PrismaModule,

    HealthModule,

    LoggerModule,

    AuthModule,

    UsersModule,

    RestaurantsModule,

    MenuModule,

    OrdersModule,

    DeliveryModule

  ],

})
export class AppModule {}