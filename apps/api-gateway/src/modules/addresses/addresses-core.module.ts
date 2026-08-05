import { Module } from '@nestjs/common';

import { AddressesService } from './services/addresses.service';

import { AddressesRepository } from './repositories/addresses.repository';

/**
 * Controller-free core of the addresses feature — needed by `OrdersCoreModule`
 * (`OrdersService` injects `AddressesService` directly). Kept separate from `AddressesModule`
 * (which owns `AddressesController`) so importing it never pulls a controller into the Worker
 * process.
 */
@Module({
  providers: [AddressesService, AddressesRepository],

  exports: [AddressesService, AddressesRepository],
})
export class AddressesCoreModule {}
