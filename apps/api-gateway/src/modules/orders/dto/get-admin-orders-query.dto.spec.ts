import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { GetAdminOrdersQueryDto } from './get-admin-orders-query.dto';

/**
 * P0-FIN-1B — regression coverage for the new `paymentStatus` filter on the admin orders query
 * (added so an operator can query e.g. status=CANCELLED&paymentStatus=PAID directly — see the
 * 2026-09 cancellation-refund review's operator-visibility finding). Mirrors
 * create-address.dto.spec.ts's existing class-validator testing convention.
 */
function buildDto(
  overrides: Partial<GetAdminOrdersQueryDto> = {},
): GetAdminOrdersQueryDto {
  return plainToInstance(GetAdminOrdersQueryDto, { ...overrides });
}

describe('GetAdminOrdersQueryDto validation — paymentStatus', () => {
  it('accepts a query with paymentStatus omitted (existing behavior unchanged)', async () => {
    const errors = await validate(buildDto());
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid paymentStatus value', async () => {
    const errors = await validate(
      buildDto({ paymentStatus: PaymentStatus.PAID }),
    );
    expect(errors).toHaveLength(0);
  });

  it('accepts paymentStatus combined with status', async () => {
    const errors = await validate(
      buildDto({
        status: OrderStatus.CANCELLED,
        paymentStatus: PaymentStatus.PAID,
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects an unknown paymentStatus value', async () => {
    const dto = buildDto({
      paymentStatus: 'NOT_A_REAL_STATUS' as PaymentStatus,
    });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'paymentStatus')).toBe(
      true,
    );
  });
});
