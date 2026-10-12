import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
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
    issueOtp: jest.Mock;
    recordFailedAttempt: jest.Mock;
    markStatus: jest.Mock;
    markVerifiedIfPending: jest.Mock;
    revertVerification: jest.Mock;
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
      issueOtp: jest.fn(),
      recordFailedAttempt: jest.fn(),
      markStatus: jest.fn(),
      markVerifiedIfPending: jest.fn().mockResolvedValue(true),
      revertVerification: jest.fn().mockResolvedValue({ count: 1 }),
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
    beforeEach(() => {
      proofRepository.findActiveAssignmentForOrder.mockResolvedValue({
        id: 'assignment-1',
        arrivedAtRestaurantAt: new Date(),
      });
    });

    it('rejects a rider who has not marked arrival at the restaurant yet (arrive → photo → pickup)', async () => {
      proofRepository.findActiveAssignmentForOrder.mockResolvedValue({
        id: 'assignment-1',
        arrivedAtRestaurantAt: null,
      });

      await expect(
        service.uploadPickupPhoto('order-1', buildFile(), RIDER),
      ).rejects.toThrow(/Mark your arrival/);

      expect(storageService.uploadWithMetadata).not.toHaveBeenCalled();
    });

    it('rejects when the rider has no active accepted assignment for the order', async () => {
      proofRepository.findActiveAssignmentForOrder.mockResolvedValue(null);

      await expect(
        service.uploadPickupPhoto('order-1', buildFile(), RIDER),
      ).rejects.toThrow(ForbiddenException);

      expect(storageService.uploadWithMetadata).not.toHaveBeenCalled();
    });

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
      proofRepository.issueOtp.mockResolvedValue({
        issued: true,
        otp: { id: 'otp-1', expiresAt: new Date(), maxAttempts: 5 },
      });

      const result = await service.generateDeliveryOtp('order-1', RIDER);

      expect(result.type).toBe(DeliveryProofType.DELIVERY);
      expect(proofRepository.issueOtp).toHaveBeenCalled();
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

  describe('pickup OTP removed (2026-10-11 pickup revision)', () => {
    it('no longer exposes pickup OTP generation or verification', () => {
      const surface = service as unknown as Record<string, unknown>;

      expect(surface['generatePickupOtp']).toBeUndefined();
      expect(surface['verifyPickupOtp']).toBeUndefined();
    });
  });

  describe('verifyDeliveryOtp — state, attempt-limit and concurrency guards', () => {
    const PENDING_OTP = {
      id: 'otp-1',
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 60_000),
      otpHash: 'hashed',
      orderId: 'order-1',
      type: DeliveryProofType.DELIVERY,
    };

    beforeEach(() => {
      ordersService.getOrderOwnership.mockResolvedValue(
        buildOrder({ status: OrderStatus.OUT_FOR_DELIVERY }),
      );
      proofRepository.findOtp.mockResolvedValue(PENDING_OTP);
    });

    it('rejects verification once the order is no longer OUT_FOR_DELIVERY, without touching the OTP', async () => {
      ordersService.getOrderOwnership.mockResolvedValue(
        buildOrder({ status: OrderStatus.CANCELLED }),
      );

      await expect(
        service.verifyDeliveryOtp('order-1', '123456', RIDER),
      ).rejects.toThrow(BadRequestException);

      expect(proofRepository.findOtp).not.toHaveBeenCalled();
      expect(proofRepository.markVerifiedIfPending).not.toHaveBeenCalled();
    });

    it('rejects a partner who is not assigned to the order', async () => {
      await expect(
        service.verifyDeliveryOtp('order-1', '123456', OTHER_RIDER),
      ).rejects.toThrow(ForbiddenException);

      expect(ordersService.updateOrderStatus).not.toHaveBeenCalled();
    });

    it('records a wrong code atomically and reports the attempts left', async () => {
      passwordService.comparePassword.mockResolvedValue(false);
      proofRepository.recordFailedAttempt.mockResolvedValue({
        ...PENDING_OTP,
        attempts: 1,
      });

      await expect(
        service.verifyDeliveryOtp('order-1', '000000', RIDER),
      ).rejects.toThrow(/4 attempt\(s\) remaining/);

      expect(proofRepository.recordFailedAttempt).toHaveBeenCalledWith(
        'otp-1',
        5,
      );
      expect(ordersService.updateOrderStatus).not.toHaveBeenCalled();
    });

    it('treats the attempt that reaches the cap as exhausted', async () => {
      passwordService.comparePassword.mockResolvedValue(false);
      proofRepository.recordFailedAttempt.mockResolvedValue({
        ...PENDING_OTP,
        attempts: 5,
        status: 'EXCEEDED',
      });

      await expect(
        service.verifyDeliveryOtp('order-1', '000000', RIDER),
      ).rejects.toThrow(/Maximum verification attempts exceeded/);
    });

    it('treats a wrong code as exhausted when a concurrent request already used the last attempt', async () => {
      passwordService.comparePassword.mockResolvedValue(false);
      proofRepository.recordFailedAttempt.mockResolvedValue(null);

      await expect(
        service.verifyDeliveryOtp('order-1', '000000', RIDER),
      ).rejects.toThrow(/Maximum verification attempts exceeded/);
    });

    it('rejects an expired code', async () => {
      proofRepository.findOtp.mockResolvedValue({
        ...PENDING_OTP,
        expiresAt: new Date(Date.now() - 1_000),
      });

      await expect(
        service.verifyDeliveryOtp('order-1', '123456', RIDER),
      ).rejects.toThrow(/expired/);

      expect(ordersService.updateOrderStatus).not.toHaveBeenCalled();
    });

    it('lets only one concurrent correct submission advance the order', async () => {
      proofRepository.markVerifiedIfPending.mockResolvedValue(false);

      await expect(
        service.verifyDeliveryOtp('order-1', '123456', RIDER),
      ).rejects.toThrow(ConflictException);

      expect(ordersService.updateOrderStatus).not.toHaveBeenCalled();
    });

    it('rejects a replay after the delivery was already verified', async () => {
      proofRepository.findOtp.mockResolvedValue({
        ...PENDING_OTP,
        status: 'VERIFIED',
      });

      await expect(
        service.verifyDeliveryOtp('order-1', '123456', RIDER),
      ).rejects.toThrow(ConflictException);

      expect(ordersService.updateOrderStatus).not.toHaveBeenCalled();
    });

    it('releases the verification if the order transition fails, so the OTP is not stuck', async () => {
      const failure = new BadRequestException('Invalid status transition');
      ordersService.updateOrderStatus.mockRejectedValue(failure);

      await expect(
        service.verifyDeliveryOtp('order-1', '123456', RIDER),
      ).rejects.toBe(failure);

      expect(proofRepository.revertVerification).toHaveBeenCalledWith('otp-1');
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });
  });
  describe('generateDeliveryOtp — resend cooldown and issue cap (2026-10-12)', () => {
    beforeEach(() => {
      ordersService.getOrderOwnership.mockResolvedValue(
        buildOrder({ status: OrderStatus.OUT_FOR_DELIVERY }),
      );
    });

    it('applies the 60 s cooldown and 5-code cap to the assigned delivery partner', async () => {
      proofRepository.issueOtp.mockResolvedValue({
        issued: true,
        otp: { id: 'otp-1', expiresAt: new Date(), maxAttempts: 5 },
      });

      await service.generateDeliveryOtp('order-1', RIDER);

      expect(proofRepository.issueOtp).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-1',
          type: DeliveryProofType.DELIVERY,
          maxAttempts: 5,
          limits: { cooldownMs: 60_000, maxGenerations: 5 },
        }),
      );
      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    });

    it('never puts the plaintext code anywhere but the customer notification', async () => {
      proofRepository.issueOtp.mockResolvedValue({
        issued: true,
        otp: { id: 'otp-1', expiresAt: new Date(), maxAttempts: 5 },
      });

      const result = await service.generateDeliveryOtp('order-1', RIDER);
      const [issued] = proofRepository.issueOtp.mock.calls[0] as [
        { otpHash: string },
      ];
      const auditPayload = (auditService.log.mock.calls[0] as unknown[])[5];
      const [notifiedUserId] = notificationsService.createNotification.mock
        .calls[0] as [string];

      expect(issued.otpHash).toBe('hashed');
      expect(JSON.stringify(result)).not.toMatch(/\d{6}/);
      expect(auditPayload).not.toHaveProperty('code');
      expect(notifiedUserId).toBe('customer-1');
    });

    it('refuses a resend inside the cooldown with 429 and the wait, without notifying the customer', async () => {
      proofRepository.issueOtp.mockResolvedValue({
        issued: false,
        reason: 'cooldown',
        existing: { lastGeneratedAt: new Date(Date.now() - 20_000) },
      });

      const error = await service
        .generateDeliveryOtp('order-1', RIDER)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect((error as HttpException).message).toMatch(
        /request a new one in (39|40) seconds/,
      );
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('refuses once the per-order cap is reached with 429', async () => {
      proofRepository.issueOtp.mockResolvedValue({
        issued: false,
        reason: 'limit',
        existing: { lastGeneratedAt: new Date(Date.now() - 600_000) },
      });

      const error = await service
        .generateDeliveryOtp('order-1', RIDER)
        .catch((caught: unknown) => caught);

      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect((error as HttpException).message).toMatch(/maximum of 5/);
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('never replaces an already-verified code', async () => {
      proofRepository.issueOtp.mockResolvedValue({
        issued: false,
        reason: 'verified',
        existing: { lastGeneratedAt: new Date() },
      });

      await expect(
        service.generateDeliveryOtp('order-1', RIDER),
      ).rejects.toThrow(ConflictException);
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('lets an admin issue a code without the partner limits (support override)', async () => {
      proofRepository.issueOtp.mockResolvedValue({
        issued: true,
        otp: { id: 'otp-1', expiresAt: new Date(), maxAttempts: 5 },
      });

      await service.generateDeliveryOtp('order-1', {
        userId: 'admin-1',
        role: UserRole.ADMIN,
      });

      expect(proofRepository.issueOtp).toHaveBeenCalledWith(
        expect.objectContaining({ limits: undefined }),
      );
    });

    it('refuses a partner who is not assigned to the order', async () => {
      await expect(
        service.generateDeliveryOtp('order-1', OTHER_RIDER),
      ).rejects.toThrow(ForbiddenException);
      expect(proofRepository.issueOtp).not.toHaveBeenCalled();
    });
  });
});
