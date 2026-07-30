import { Module } from '@nestjs/common';

import { AddressesController } from './controllers/addresses.controller';

import { AddressesCoreModule } from './addresses-core.module';

/**
 * HTTP-facing half of the addresses feature — controller only. `AddressesService`/
 * `AddressesRepository` live in `AddressesCoreModule`, re-exported here so existing consumers of
 * `AddressesModule` keep working unchanged.
 */
@Module({
  imports: [AddressesCoreModule],

  controllers: [AddressesController],

  exports: [AddressesCoreModule],
})
export class AddressesModule {}
