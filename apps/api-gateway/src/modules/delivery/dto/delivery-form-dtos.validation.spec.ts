import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RegisterDto } from '../../auth/dto/register.dto';
import { CreateDeliveryPartnerDto } from './create-delivery-partner.dto';
import { CreateVehicleDto } from './create-vehicle.dto';
import { UpdateVehicleDto } from './update-vehicle.dto';
import { UpsertDeliveryBankAccountDto } from './upsert-delivery-bank-account.dto';

/**
 * Delivery Partner forms — backend is authoritative. Runs the real class-validator decorators
 * (the same ones the global ValidationPipe applies) so blank/whitespace-only values that every
 * app form already rejects can't slip through a direct API call.
 */
async function failingProperties<T extends object>(
  cls: new () => T,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, payload));
  return errors.map((error) => error.property).sort();
}

describe('Delivery Partner form DTO validation', () => {
  describe('RegisterDto', () => {
    const valid = {
      firstName: 'Hari',
      lastName: 'Haran',
      email: 'hari@example.com',
      password: 'Password@123',
    };

    it('accepts a complete registration', async () => {
      expect(await failingProperties(RegisterDto, valid)).toEqual([]);
    });

    it.each(['', '   '])(
      'rejects a blank first/last name (%j)',
      async (blank) => {
        expect(
          await failingProperties(RegisterDto, {
            ...valid,
            firstName: blank,
            lastName: blank,
          }),
        ).toEqual(['firstName', 'lastName']);
      },
    );

    it('rejects a password shorter than 8 characters', async () => {
      expect(
        await failingProperties(RegisterDto, { ...valid, password: 'short' }),
      ).toEqual(['password']);
    });
  });

  describe('CreateDeliveryPartnerDto', () => {
    it('rejects a blank vehicle number', async () => {
      expect(
        await failingProperties(CreateDeliveryPartnerDto, {
          vehicleType: 'BIKE',
          vehicleNumber: '  ',
        }),
      ).toEqual(['vehicleNumber']);
    });

    it('keeps the licence number optional', async () => {
      expect(
        await failingProperties(CreateDeliveryPartnerDto, {
          vehicleType: 'ELECTRIC_VEHICLE',
          vehicleNumber: 'KA01AB1234',
        }),
      ).toEqual([]);
    });
  });

  describe('vehicle DTOs', () => {
    it('rejects a blank registration number on create', async () => {
      expect(
        await failingProperties(CreateVehicleDto, {
          vehicleType: 'BIKE',
          registrationNumber: '',
        }),
      ).toEqual(['registrationNumber']);
    });

    it('rejects a blank registration number on update but allows omitting it', async () => {
      expect(
        await failingProperties(UpdateVehicleDto, { registrationNumber: ' ' }),
      ).toEqual(['registrationNumber']);
      expect(await failingProperties(UpdateVehicleDto, {})).toEqual([]);
    });

    it('keeps the existing 1980–2100 year bounds', async () => {
      expect(
        await failingProperties(CreateVehicleDto, {
          vehicleType: 'CAR',
          registrationNumber: 'KA01AB1234',
          year: 1970,
        }),
      ).toEqual(['year']);
    });
  });

  describe('UpsertDeliveryBankAccountDto', () => {
    const valid = {
      accountHolderName: 'Hari Haran',
      bankName: 'HDFC Bank',
      accountNumber: '50100601556023',
      ifsc: 'HDFC0000042',
    };

    it('accepts a complete bank account (branch and UPI optional)', async () => {
      expect(
        await failingProperties(UpsertDeliveryBankAccountDto, valid),
      ).toEqual([]);
    });

    it('rejects blank holder and bank names', async () => {
      expect(
        await failingProperties(UpsertDeliveryBankAccountDto, {
          ...valid,
          accountHolderName: ' ',
          bankName: '',
        }),
      ).toEqual(['accountHolderName', 'bankName']);
    });

    it('rejects a short account number and a malformed IFSC', async () => {
      expect(
        await failingProperties(UpsertDeliveryBankAccountDto, {
          ...valid,
          accountNumber: '12345',
          ifsc: 'hdfc0000042',
        }),
      ).toEqual(['accountNumber', 'ifsc']);
    });
  });
});
