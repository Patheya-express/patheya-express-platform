import { Injectable, NotFoundException } from '@nestjs/common';

import { Address } from '@prisma/client';

import { AddressesRepository } from '../repositories/addresses.repository';

import { CreateAddressDto } from '../dto/create-address.dto';
import { UpdateAddressDto } from '../dto/update-address.dto';

/**
 * Single-line formatted address used to populate Order.deliveryAddress when an order is
 * placed from a saved address rather than free-text entry.
 */
export function formatAddressForOrder(address: Address): string {
  return [
    address.addressLine1,
    address.addressLine2,
    address.landmark,
    address.city,
    address.state,
    address.postalCode,
  ]
    .filter((part): part is string => Boolean(part))
    .join(', ');
}

@Injectable()
export class AddressesService {
  constructor(private readonly addressesRepository: AddressesRepository) {}

  async findAllForCustomer(customerId: string) {
    return this.addressesRepository.findAllForCustomer(customerId);
  }

  async findByIdForCustomer(addressId: string, customerId: string) {
    const address = await this.addressesRepository.findByIdForCustomer(
      addressId,
      customerId,
    );

    if (!address) {
      throw new NotFoundException('Address not found');
    }

    return address;
  }

  /** The first address a customer ever saves is always the default — there's no meaningful choice yet. */
  async create(customerId: string, dto: CreateAddressDto) {
    const existingCount =
      await this.addressesRepository.countForCustomer(customerId);

    const shouldBeDefault = dto.isDefault || existingCount === 0;

    if (shouldBeDefault) {
      await this.addressesRepository.unsetDefaultForCustomer(customerId);
    }

    return this.addressesRepository.create({
      customerId,
      label: dto.label,
      customLabel: dto.customLabel,
      addressLine1: dto.addressLine1,
      addressLine2: dto.addressLine2,
      city: dto.city,
      state: dto.state,
      postalCode: dto.postalCode,
      landmark: dto.landmark,
      deliveryInstructions: dto.deliveryInstructions,
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracy: dto.accuracy,
      altitude: dto.altitude,
      heading: dto.heading,
      speed: dto.speed,
      locationSource: dto.locationSource,
      provider: dto.provider,
      providerPlaceId: dto.providerPlaceId,
      providerMetadata: dto.providerMetadata,
      isDefault: shouldBeDefault,
    });
  }

  async update(customerId: string, addressId: string, dto: UpdateAddressDto) {
    await this.findByIdForCustomer(addressId, customerId);

    if (dto.isDefault) {
      await this.addressesRepository.unsetDefaultForCustomer(customerId);
    }

    return this.addressesRepository.update(addressId, dto);
  }

  async setDefault(customerId: string, addressId: string) {
    await this.findByIdForCustomer(addressId, customerId);

    await this.addressesRepository.unsetDefaultForCustomer(customerId);

    return this.addressesRepository.update(addressId, { isDefault: true });
  }

  /** If the deleted address was the default, the most recently added remaining address is promoted. */
  async remove(customerId: string, addressId: string) {
    const address = await this.findByIdForCustomer(addressId, customerId);

    await this.addressesRepository.delete(addressId);

    if (address.isDefault) {
      await this.addressesRepository.promoteMostRecentToDefault(customerId);
    }

    return { success: true };
  }
}
