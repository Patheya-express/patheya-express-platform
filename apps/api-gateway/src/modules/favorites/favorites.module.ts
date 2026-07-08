import { Module } from '@nestjs/common';

import { FavoritesController } from './controllers/favorites.controller';

import { FavoritesService } from './services/favorites.service';

import { FavoritesRepository } from './repositories/favorites.repository';

@Module({
  controllers: [FavoritesController],

  providers: [FavoritesService, FavoritesRepository],

  exports: [FavoritesService],
})
export class FavoritesModule {}
