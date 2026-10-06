import { AssignmentStatus } from '@prisma/client';

import { DispatchService } from './dispatch.service';

/**
 * Live-bug regression (delivery workflow manual test, 2026-09-16) — DispatchService.getAssignments
 * must give the rider a usable pickup location even when Order.branchId is null (verified against
 * production data: ~1 in 4 orders). RestaurantBranch.isPrimary/isActive already exist for exactly
 * this "default location" case, so the fallback reuses them rather than duplicating address data
 * onto Order. Also covers the Delivery Proof & Trust derived boolean (pickupPhotoUploaded) added
 * alongside it in the same mapper.
 */

const PRIMARY_BRANCH = {
  addressLine1: '373 Road Number 10',
  addressLine2: null,
  city: 'Hyderabad',
  state: 'Telangana',
  postalCode: '500073',
  latitude: 17.4333935,
  longitude: 78.4083261,
};

const EXPLICIT_BRANCH = {
  addressLine1: '221B Baker Street',
  addressLine2: null,
  city: 'London',
  state: 'Greater London',
  postalCode: 'NW1',
  latitude: 51.5237,
  longitude: -0.1585,
};

function buildAssignment(orderOverrides: Record<string, unknown> = {}) {
  return {
    id: 'assignment-1',
    orderId: 'order-1',
    deliveryPartnerId: 'partner-1',
    status: AssignmentStatus.ACCEPTED,
    assignedAt: new Date('2026-09-16T00:00:00.000Z'),
    order: {
      id: 'order-1',
      orderNumber: 'ORD-1',
      status: 'READY_FOR_PICKUP',
      customer: {
        id: 'customer-1',
        firstName: 'Siddu',
        lastName: 'J',
        phone: '9999999999',
      },
      restaurant: {
        id: 'restaurant-1',
        name: "Siddhu's Kitchen",
        phone: '8888888888',
        branches: [PRIMARY_BRANCH],
      },
      branch: null,
      items: [],
      proofPhotos: [],
      ...orderOverrides,
    },
  };
}

describe('DispatchService.getAssignments — pickup-location fallback', () => {
  let service: DispatchService;
  let repository: {
    findPartnerByUserId: jest.Mock;
    findPartnerAssignments: jest.Mock;
  };

  beforeEach(() => {
    repository = {
      findPartnerByUserId: jest.fn().mockResolvedValue({ id: 'partner-1' }),
      findPartnerAssignments: jest.fn(),
    };

    service = new DispatchService(
      repository as any,
      {} as any, // realtimeService
      {} as any, // queueService
      {} as any, // presenceService
      {} as any, // eventBus
      {} as any, // logger
      {} as any, // auditService
      {} as any, // metrics
    );
  });

  it("falls back to the restaurant's primary active branch when the order has no branch of its own", async () => {
    repository.findPartnerAssignments.mockResolvedValue([buildAssignment()]);

    const [result] = await service.getAssignments('user-1');

    expect(result.order.branch).toEqual(PRIMARY_BRANCH);
  });

  it("keeps the order's own branch when one is set (no fallback override)", async () => {
    repository.findPartnerAssignments.mockResolvedValue([
      buildAssignment({ branch: EXPLICIT_BRANCH }),
    ]);

    const [result] = await service.getAssignments('user-1');

    expect(result.order.branch).toEqual(EXPLICIT_BRANCH);
  });

  it('does not leak the raw restaurant.branches array onto the response', async () => {
    repository.findPartnerAssignments.mockResolvedValue([buildAssignment()]);

    const [result] = await service.getAssignments('user-1');

    expect(result.order.restaurant.branches).toBeUndefined();
  });

  it('is undefined (not null/crash) when the restaurant has no primary active branch either', async () => {
    repository.findPartnerAssignments.mockResolvedValue([
      buildAssignment({
        restaurant: {
          id: 'restaurant-1',
          name: 'No Branch Yet',
          phone: undefined,
          branches: [],
        },
      }),
    ]);

    const [result] = await service.getAssignments('user-1');

    expect(result.order.branch).toBeUndefined();
  });

  it('still derives pickupPhotoUploaded correctly alongside the branch fallback', async () => {
    repository.findPartnerAssignments.mockResolvedValue([
      buildAssignment({
        proofPhotos: [{ id: 'photo-1' }],
      }),
    ]);

    const [result] = await service.getAssignments('user-1');

    expect(result.order.pickupPhotoUploaded).toBe(true);
  });
});
