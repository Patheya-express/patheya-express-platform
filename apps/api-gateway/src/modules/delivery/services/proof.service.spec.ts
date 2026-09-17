import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryProofType,
  OrderStatus,
  Prisma,
  UserRole,
} from '@prisma/client';

import { ProofService } from './proof.service';

/**
 * Business requirement (delivery parcel photo evidence + 100m restaurant-arrival geofence +
 * OTP-gated delivery) — covers ProofService's authoritative gates:
 *  1. uploadPickupPhoto — write-once evidence, rider-owned-assignment only.
 *  2. markRestaurantArrival — rider-owned-assignment only, backend-validated 100m geofence
 *     against the order's actual pickup coordinates (never trusts a client-asserted "arrived").
 *  3. generate()/verify() for DELIVERY no longer depend on any customer-confirmation step — the
 *     2026-09-16 business-workflow revision removed that gate; the photo is reference-only.
 * Only the true I/O boundaries (ProofRepository, OrdersService, StorageService, RealtimeService,
 * AuditService, NotificationsService, PasswordService, PrismaService) are mocked.
 */

const RESTAURANT_COORDS = { latitude: 12.9716, longitude: 77.5946 };
// ~1.1km north of RESTAURANT_COORDS — comfortably outside the 100m arrival radius.
const FAR_COORDS = { latitude: 12.9816, longitude: 77.5946 };

function buildOrder(overrides: Partial<any> = {}) {
  return {
    id: 'order-1',
    customerId: 'customer-1',
    restaurantId: 'restaurant-1',
    deliveryPartnerId: 'rider-1',
    status: OrderStatus.READY_FOR_PICKUP,
    ...overrides,
  };
}

function buildUniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const RIDER = { userId: 'rider-1', role: UserRole.DELIVERY_PARTNER };
const OTHER_RIDER = { userId: 'rider-2', role: UserRole.DELIVERY_PARTNER };
const CUSTOMER = { userId: 'customer-1', role: UserRole.CUSTOMER };
const OTHER_CUSTOMER = { userId: 'customer-2', role: UserRole.CUSTOMER };

describe('ProofService', () => {
  let service: ProofService;
  let proofRepository: {
    findOtp: jest.Mock;
    upsertOtp: jest.Mock;
    incrementAttempts: jest.Mock;
    markStatus: jest.Mock;
    markVerified: jest.Mock;
    findPhoto: jest.Mock;
    createPhoto: jest.Mock;
    findActiveAssignmentForOrder: jest.Mock;
    findAssignmentForOrder: jest.Mock;
    markArrival: jest.Mock;
  };
  let ordersService: {
    getOrderOwnership: jest.Mock;
    updateOrderStatus: jest.Mock;
    getPickupLocation: jest.Mock;
  };
  let realtimeService: { emitToOrder: jest.Mock };
  let auditService: { log: jest.Mock };
  let notificationsService: { createNotification: jest.Mock };
  let passwordService: { hashPassword: jest.Mock; comparePassword: jest.Mock };
  let storageService: { uploadWithMetadata: jest.Mock };
  let prisma: any;

  beforeEach(() => {
    proofRepository = {
      findOtp: jest.fn(),
      upsertOtp: jest.fn(),
      incrementAttempts: jest.fn(),
      markStatus: jest.fn(),
      markVerified: jest.fn(),
      findPhoto: jest.fn().mockResolvedValue(null),
      createPhoto: jest.fn(),
      findActiveAssignmentForOrder: jest
        .fn()
        .mockResolvedValue({ id: 'assignment-1', arrivedAtRestaurantAt: null }),
      findAssignmentForOrder: jest.fn().mockResolvedValue(null),
      markArrival: jest.fn(),
    };

    ordersService = {
      getOrderOwnership: jest.fn().mockResolvedValue(buildOrder()),
      updateOrderStatus: jest
        .fn()
        .mockResolvedValue(buildOrder({ status: OrderStatus.DELIVERED })),
      getPickupLocation: jest.fn().mockResolvedValue(RESTAURANT_COORDS),
    };

    realtimeService = { emitToOrder: jest.fn() };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    notificationsService = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };
    passwordService = {
      hashPassword: jest.fn().mockResolvedValue('hashed'),
      comparePassword: jest.fn().mockResolvedValue(true),
    };
    storageService = {
      uploadWithMetadata: jest.fn().mockResolvedValue({
        url: 'https://cdn.test/photo.jpg',
        secureUrl: undefined,
      }),
    };
    prisma = {};

    service = new ProofService(
      proofRepository as any,
      ordersService as any,
      realtimeService as any,
      auditService as any,
      notificationsService as any,
      passwordService,
      storageService as any,
      prisma,
    );
  });

  function buildFile(overrides: Partial<Express.Multer.File> = {}) {
    return {
      originalname: 'parcel.jpg',
      mimetype: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('fake'),
      ...overrides,
    } as Express.Multer.File;
  }

  describe('uploadPickupPhoto', () => {
    it('rejects a rider who is not the assigned partner', async () => {
      await expect(
        service.uploadPickupPhoto('order-1', buildFile(), OTHER_RIDER),
      ).rejects.toThrow(ForbiddenException);

      expect(storageService.uploadWithMetadata).not.toHaveBeenCalled();
    });

    it('rejects upload while the order is not READY_FOR_PICKUP', async () => {
      ordersService.getOrderOwnership.mockResolvedValue(
        buildOrder({ status: OrderStatus.CONFIRMED }),
      );

      await expect(
        service.uploadPickupPhoto('order-1', buildFile(), RIDER),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a second upload for the same order (write-once evidence)', async () => {
      proofRepository.findPhoto.mockResolvedValue({ id: 'existing-photo' });

      await expect(
        service.uploadPickupPhoto('order-1', buildFile(), RIDER),
      ).rejects.toThrow(ConflictException);

      expect(storageService.uploadWithMetadata).not.toHaveBeenCalled();
    });

    it('maps a concurrent-write unique-constraint race to a ConflictException instead of a 500', async () => {
      proofRepository.createPhoto.mockRejectedValue(
        buildUniqueConstraintError(),
      );

      await expect(
        service.uploadPickupPhoto('order-1', buildFile(), RIDER),
      ).rejects.toThrow(ConflictException);
    });

    it('uploads via StorageService and creates the evidence row on success', async () => {
      proofRepository.createPhoto.mockResolvedValue({
        id: 'photo-1',
        orderId: 'order-1',
        type: DeliveryProofType.PICKUP,
        storageUrl: 'https://cdn.test/photo.jpg',
        fileName: 'parcel.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        uploadedById: 'rider-1',
        createdAt: new Date(),
      });

      const result = await service.uploadPickupPhoto(
        'order-1',
        buildFile(),
        RIDER,
      );

      expect(storageService.uploadWithMetadata).toHaveBeenCalledWith(
        expect.anything(),
        'delivery-proof/pickup',
      );
      expect(result.id).toBe('photo-1');
      expect(realtimeService.emitToOrder).toHaveBeenCalledWith(
        'order-1',
        'pickup.photo.uploaded',
        expect.anything(),
      );
    });
  });

  describe('getPickupPhoto', () => {
    it('404s when no photo exists yet', async () => {
      await expect(service.getPickupPhoto('order-1', CUSTOMER)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a user with no relationship to the order', async () => {
      proofRepository.findPhoto.mockResolvedValue({ id: 'photo-1' });

      await expect(
        service.getPickupPhoto('order-1', OTHER_CUSTOMER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns the photo for the order customer', async () => {
      proofRepository.findPhoto.mockResolvedValue({
        id: 'photo-1',
        orderId: 'order-1',
        type: DeliveryProofType.PICKUP,
        storageUrl: 'https://cdn.test/photo.jpg',
        fileName: 'parcel.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        uploadedById: 'rider-1',
        createdAt: new Date(),
      });

      const result = await service.getPickupPhoto('order-1', CUSTOMER);

      expect(result.id).toBe('photo-1');
    });
  });

  describe('markRestaurantArrival', () => {
    it('rejects a rider who is not the assigned partner', async () => {
      await expect(
        service.markRestaurantArrival(
          'order-1',
          RESTAURANT_COORDS.latitude,
          RESTAURANT_COORDS.longitude,
          OTHER_RIDER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects while the order is not READY_FOR_PICKUP', async () => {
      ordersService.getOrderOwnership.mockResolvedValue(
        buildOrder({ status: OrderStatus.OUT_FOR_DELIVERY }),
      );

      await expect(
        service.markRestaurantArrival(
          'order-1',
          RESTAURANT_COORDS.latitude,
          RESTAURANT_COORDS.longitude,
          RIDER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when there is no active accepted assignment for this rider/order', async () => {
      proofRepository.findActiveAssignmentForOrder.mockResolvedValue(null);

      await expect(
        service.markRestaurantArrival(
          'order-1',
          RESTAURANT_COORDS.latitude,
          RESTAURANT_COORDS.longitude,
          RIDER,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(proofRepository.markArrival).not.toHaveBeenCalled();
    });

    it('rejects when the order has no pickup location on record', async () => {
      ordersService.getPickupLocation.mockResolvedValue(null);

      await expect(
        service.markRestaurantArrival(
          'order-1',
          RESTAURANT_COORDS.latitude,
          RESTAURANT_COORDS.longitude,
          RIDER,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(proofRepository.markArrival).not.toHaveBeenCalled();
    });

    it('rejects — with the measured distance in the message — when the rider is outside the 100m radius', async () => {
      await expect(
        service.markRestaurantArrival(
          'order-1',
          FAR_COORDS.latitude,
          FAR_COORDS.longitude,
          RIDER,
        ),
      ).rejects.toThrow(/\d+m from the restaurant/);

      expect(proofRepository.markArrival).not.toHaveBeenCalled();
    });

    it('accepts, records the timestamp, notifies the customer, and emits the realtime event when within 100m', async () => {
      const arrivedAt = new Date();
      proofRepository.markArrival.mockResolvedValue({
        id: 'assignment-1',
        arrivedAtRestaurantAt: arrivedAt,
      });

      const result = await service.markRestaurantArrival(
        'order-1',
        RESTAURANT_COORDS.latitude,
        RESTAURANT_COORDS.longitude,
        RIDER,
      );

      expect(result.arrivedAtRestaurantAt).toBe(arrivedAt);
      expect(proofRepository.markArrival).toHaveBeenCalledWith('assignment-1');
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        'customer-1',
        'RIDER_ARRIVED_AT_RESTAURANT',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
      expect(realtimeService.emitToOrder).toHaveBeenCalledWith(
        'order-1',
        'delivery.arrived_at_restaurant',
        expect.anything(),
      );
    });

    it('is idempotent — a rider already marked arrived is not re-checked against the geofence', async () => {
      const arrivedAt = new Date();
      proofRepository.findActiveAssignmentForOrder.mockResolvedValue({
        id: 'assignment-1',
        arrivedAtRestaurantAt: arrivedAt,
      });
      proofRepository.markArrival.mockResolvedValue({
        id: 'assignment-1',
        arrivedAtRestaurantAt: arrivedAt,
      });

      const result = await service.markRestaurantArrival(
        'order-1',
        FAR_COORDS.latitude, // even far away — already-arrived is not re-validated
        FAR_COORDS.longitude,
        RIDER,
      );

      expect(result.arrivedAtRestaurantAt).toBe(arrivedAt);
      expect(ordersService.getPickupLocation).not.toHaveBeenCalled();
    });
  });

  describe('getArrivalStatus', () => {
    it('returns null when the rider has not arrived yet', async () => {
      proofRepository.findAssignmentForOrder.mockResolvedValue({
        id: 'assignment-1',
        arrivedAtRestaurantAt: null,
      });

      const result = await service.getArrivalStatus('order-1', CUSTOMER);

      expect(result.arrivedAtRestaurantAt).toBeNull();
    });

    it('returns the timestamp once arrived', async () => {
      const arrivedAt = new Date();
      proofRepository.findAssignmentForOrder.mockResolvedValue({
        id: 'assignment-1',
        arrivedAtRestaurantAt: arrivedAt,
      });

      const result = await service.getArrivalStatus('order-1', CUSTOMER);

      expect(result.arrivedAtRestaurantAt).toBe(arrivedAt);
    });

    it('rejects a user with no relationship to the order', async () => {
      await expect(
        service.getArrivalStatus('order-1', OTHER_CUSTOMER),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delivery OTP no longer depends on customer parcel confirmation (2026-09-16 revision)', () => {
    beforeEach(() => {
      ordersService.getOrderOwnership.mockResolvedValue(
        buildOrder({ status: OrderStatus.OUT_FOR_DELIVERY }),
      );
    });

    it('generates a delivery OTP with no confirmation of any kind on record', async () => {
      proofRepository.upsertOtp.mockResolvedValue({
        id: 'otp-1',
        expiresAt: new Date(),
        maxAttempts: 5,
      });

      const result = await service.generateDeliveryOtp('order-1', RIDER);

      expect(result.type).toBe(DeliveryProofType.DELIVERY);
      expect(proofRepository.upsertOtp).toHaveBeenCalled();
    });

    it('verifies a delivery OTP with no confirmation of any kind on record', async () => {
      proofRepository.findOtp.mockResolvedValue({
        id: 'otp-1',
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 60_000),
        otpHash: 'hashed',
        orderId: 'order-1',
        type: DeliveryProofType.DELIVERY,
      });
      proofRepository.markVerified.mockResolvedValue(undefined);

      const result = await service.verifyDeliveryOtp(
        'order-1',
        '123456',
        RIDER,
      );

      expect(result.orderStatus).toBe(OrderStatus.DELIVERED);
      expect(ordersService.updateOrderStatus).toHaveBeenCalledWith(
        'order-1',
        { status: OrderStatus.DELIVERED },
        RIDER,
      );
    });
  });

  describe('verifyPickupOtp — photo-required pre-check (live-testing regression)', () => {
    /**
     * Found during live testing of this exact revision: verify() used to call
     * proofRepository.markVerified() (flips the OTP row to VERIFIED) *before*
     * OrdersService.updateOrderStatus() ran assertPhotoVerifiedForStatus. Without a photo, that
     * update threw — but the OTP had already been marked VERIFIED, so the order was stuck at
     * READY_FOR_PICKUP forever while every subsequent verify attempt (even after uploading the
     * photo) failed with "already verified", with no way to progress. The fix checks the photo
     * before touching the OTP row at all.
     */
    beforeEach(() => {
      ordersService.getOrderOwnership.mockResolvedValue(
        buildOrder({ status: OrderStatus.READY_FOR_PICKUP }),
      );
    });

    it('rejects before marking the OTP verified when no pickup photo exists yet', async () => {
      proofRepository.findPhoto.mockResolvedValue(null);

      await expect(
        service.verifyPickupOtp('order-1', '123456', RIDER),
      ).rejects.toThrow(ForbiddenException);

      expect(proofRepository.findOtp).not.toHaveBeenCalled();
      expect(proofRepository.markVerified).not.toHaveBeenCalled();
      expect(ordersService.updateOrderStatus).not.toHaveBeenCalled();
    });

    it('succeeds once the pickup photo exists', async () => {
      proofRepository.findPhoto.mockResolvedValue({ id: 'photo-1' });
      proofRepository.findOtp.mockResolvedValue({
        id: 'otp-1',
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 60_000),
        otpHash: 'hashed',
        orderId: 'order-1',
        type: DeliveryProofType.PICKUP,
      });
      proofRepository.markVerified.mockResolvedValue(undefined);
      ordersService.updateOrderStatus.mockResolvedValue(
        buildOrder({ status: OrderStatus.OUT_FOR_DELIVERY }),
      );

      const result = await service.verifyPickupOtp('order-1', '123456', RIDER);

      expect(result.orderStatus).toBe(OrderStatus.OUT_FOR_DELIVERY);
      expect(proofRepository.markVerified).toHaveBeenCalledWith('otp-1');
    });
  });
});
