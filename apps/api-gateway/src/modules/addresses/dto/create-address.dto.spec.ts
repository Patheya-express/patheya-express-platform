import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AddressLabel, LocationSource, MapProvider } from '@prisma/client';
import { CreateAddressDto } from './create-address.dto';

function buildValidDto(
  overrides: Partial<CreateAddressDto> = {},
): CreateAddressDto {
  return plainToInstance(CreateAddressDto, {
    label: AddressLabel.HOME,
    addressLine1: '221B Baker Street',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560001',
    ...overrides,
  });
}

describe('CreateAddressDto validation', () => {
  it('accepts a minimal valid address', async () => {
    const errors = await validate(buildValidDto());
    expect(errors).toHaveLength(0);
  });

  it('accepts a fully populated map-picker payload', async () => {
    const dto = buildValidDto({
      latitude: 12.9716,
      longitude: 77.5946,
      accuracy: 12.5,
      altitude: 900,
      heading: 45,
      speed: 0,
      locationSource: LocationSource.GPS,
      provider: MapProvider.GOOGLE_MAPS,
      providerPlaceId: 'ChIJbU60yXAWrjsR4E9-UejD3_g',
      providerMetadata: { formattedAddress: '221B Baker Street, Bengaluru' },
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it.each([
    ['latitude', 91],
    ['latitude', -91],
    ['longitude', 181],
    ['longitude', -181],
  ])('rejects an out-of-range %s of %d', async (field, value) => {
    const dto = buildValidDto({ [field]: value });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === field)).toBe(true);
  });

  it('rejects a negative accuracy', async () => {
    const dto = buildValidDto({ accuracy: -5 });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'accuracy')).toBe(true);
  });

  it('rejects an unknown locationSource', async () => {
    const dto = buildValidDto({ locationSource: 'TELEPORT' as LocationSource });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'locationSource')).toBe(
      true,
    );
  });

  it('rejects an unknown provider', async () => {
    const dto = buildValidDto({ provider: 'BING_MAPS' as MapProvider });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'provider')).toBe(true);
  });
});
