import { randomUUID } from 'crypto';

import {
  AssignmentStatus,
  DeliveryPartnerStatus,
  OrderStatus,
  UserRole,
  VehicleType,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AppLoggerService } from '../../../infrastructure/logger/logger.service';
import { MetricsService } from '../../metrics/metrics.service';
import { DispatchRepository } from './dispatch.repository';
import { DeliveryRepository } from '../../delivery/repositories/delivery.repository';

/**
 * Sprint 1.7 — real-database concurrency proof for dispatch/assignment integrity.
 *
 * Mirrors coupons.repository.concurrency.spec.ts (Sprint 1.3) and
 * payments.concurrency.spec.ts (Sprint 1.5): every other dispatch/delivery spec mocks Prisma
 * entirely, which cannot prove a conditional-UPDATE claim or an advisory-lock-guarded
 * transaction actually holds under genuine concurrent load — a mock has no locking/isolation
 * semantics to get wrong. This runs real `Promise.allSettled` batches against a real Postgres
 * connection (same `DATABASE_URL` every other concurrency spec in this codebase assumes) and
 * asserts on the actual row state afterward. Tested at the repository level (not through
 * DispatchService) because, unlike coupons' SERIALIZABLE-conflict retry, nothing here has retry
 * logic to prove — every claim is a single conditional updateMany/transaction, so the repository
 * is the real unit under test, same reasoning PaymentsRepository.claimStatusTransition itself is
 * covered directly in payments.repository tests.
 */
describe('DispatchRepository — dispatch/assignment concurrency (real database)', () => {
  const prisma = new PrismaService(
    { warn: () => undefined } as unknown as AppLoggerService,
    {} as unknown as MetricsService,
  );
  const dispatchRepository = new DispatchRepository(prisma);
  const deliveryRepository = new DeliveryRepository(prisma);

  const createdUserIds: string[] = [];
  const createdOrderIds: string[] = [];

  let restaurantId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const restaurant = await prisma.restaurant.findFirst({
      select: { id: true },
    });

    if (!restaurant) {
      throw new Error(
        'No restaurant row found in the test database — seed one before running dispatch concurrency specs.',
      );
    }

    restaurantId = restaurant.id;
  });

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      // DeliveryAssignment rows cascade-delete with their Order (schema.prisma: onDelete: Cascade).
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdUserIds.length > 0) {
      // DeliveryPartner rows cascade-delete with their User (schema.prisma: onDelete: Cascade).
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  async function createCustomer(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        firstName: 'Concurrency',
        lastName: 'Customer',
        role: UserRole.CUSTOMER,
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  async function createPartner(
    status: DeliveryPartnerStatus = DeliveryPartnerStatus.AVAILABLE,
  ): Promise<{ userId: string; partnerId: string }> {
    const user = await prisma.user.create({
      data: {
        firstName: 'Concurrency',
        lastName: 'Partner',
        role: UserRole.DELIVERY_PARTNER,
      },
    });
    createdUserIds.push(user.id);

    const partner = await prisma.deliveryPartner.create({
      data: {
        userId: user.id,
        vehicleType: VehicleType.BIKE,
        vehicleNumber: `CONC-${randomUUID().slice(0, 6).toUpperCase()}`,
        status,
        isVerified: true,
      },
    });

    return { userId: user.id, partnerId: partner.id };
  }

  async function createOrder(
    customerId: string,
    status: OrderStatus = OrderStatus.READY_FOR_PICKUP,
  ): Promise<string> {
    const order = await prisma.order.create({
      data: {
        customerId,
        restaurantId,
        orderNumber: `ORD-CONC-${randomUUID().slice(0, 8).toUpperCase()}`,
        subtotalAmount: 500,
        deliveryFee: 40,
        taxAmount: 25,
        totalAmount: 565,
        deliveryAddress: 'Concurrency test address',
        status,
      },
    });
    createdOrderIds.push(order.id);
    return order.id;
  }

  async function createPendingAssignment(orderId: string, partnerId: string) {
    return prisma.deliveryAssignment.create({
      data: {
        orderId,
        deliveryPartnerId: partnerId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
  }

  it('two different partners racing to accept two separate offers for the same order: exactly one wins', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const partnerA = await createPartner();
    const partnerB = await createPartner();
    const assignmentA = await createPendingAssignment(
      orderId,
      partnerA.partnerId,
    );
    const assignmentB = await createPendingAssignment(
      orderId,
      partnerB.partnerId,
    );

    const results = await Promise.allSettled([
      dispatchRepository.acceptAssignmentAtomic({
        assignmentId: assignmentA.id,
        deliveryPartnerId: partnerA.partnerId,
        deliveryPartnerUserId: partnerA.userId,
        orderId,
      }),
      dispatchRepository.acceptAssignmentAtomic({
        assignmentId: assignmentB.id,
        deliveryPartnerId: partnerB.partnerId,
        deliveryPartnerUserId: partnerB.userId,
        orderId,
      }),
    ]);

    const accepted = results.filter(
      (r) => r.status === 'fulfilled' && r.value.accepted,
    );
    expect(accepted).toHaveLength(1);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(order.deliveryPartnerId).not.toBeNull();

    const acceptedAssignments = await prisma.deliveryAssignment.count({
      where: { orderId, status: AssignmentStatus.ACCEPTED },
    });
    expect(acceptedAssignments).toBe(1);

    // The losing partner's own assignment row must not be left ACCEPTED either — its claim
    // failed at the partner-availability step and rolled back to PENDING (see next test for an
    // explicit assertion of this).
    const totalAccepted = await prisma.deliveryAssignment.count({
      where: {
        id: { in: [assignmentA.id, assignmentB.id] },
        status: AssignmentStatus.ACCEPTED,
      },
    });
    expect(totalAccepted).toBe(1);
  }, 20000);

  it('twenty different partners racing to accept twenty separate offers for the same order: exactly one wins', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const partners = await Promise.all(
      Array.from({ length: 20 }, () => createPartner()),
    );
    const assignments = await Promise.all(
      partners.map((partner) =>
        createPendingAssignment(orderId, partner.partnerId),
      ),
    );

    const results = await Promise.allSettled(
      assignments.map((assignment, i) =>
        dispatchRepository.acceptAssignmentAtomic({
          assignmentId: assignment.id,
          deliveryPartnerId: partners[i].partnerId,
          deliveryPartnerUserId: partners[i].userId,
          orderId,
        }),
      ),
    );

    const accepted = results.filter(
      (r) => r.status === 'fulfilled' && r.value.accepted,
    );
    expect(accepted).toHaveLength(1);

    const acceptedAssignments = await prisma.deliveryAssignment.count({
      where: { orderId, status: AssignmentStatus.ACCEPTED },
    });
    expect(acceptedAssignments).toBe(1);

    const onDeliveryPartners = await prisma.deliveryPartner.count({
      where: {
        id: { in: partners.map((p) => p.partnerId) },
        status: DeliveryPartnerStatus.ON_DELIVERY,
      },
    });
    expect(onDeliveryPartners).toBe(1);
  }, 20000);

  it('the same partner offered two different orders simultaneously: exactly one accept succeeds, the other is rejected as partner_not_available', async () => {
    const customer = await createCustomer();
    const partner = await createPartner();
    const orderX = await createOrder(customer);
    const orderY = await createOrder(customer);
    const assignmentX = await createPendingAssignment(
      orderX,
      partner.partnerId,
    );
    const assignmentY = await createPendingAssignment(
      orderY,
      partner.partnerId,
    );

    const results = await Promise.all([
      dispatchRepository.acceptAssignmentAtomic({
        assignmentId: assignmentX.id,
        deliveryPartnerId: partner.partnerId,
        deliveryPartnerUserId: partner.userId,
        orderId: orderX,
      }),
      dispatchRepository.acceptAssignmentAtomic({
        assignmentId: assignmentY.id,
        deliveryPartnerId: partner.partnerId,
        deliveryPartnerUserId: partner.userId,
        orderId: orderY,
      }),
    ]);

    const accepted = results.filter((r) => r.accepted);
    const rejected = results.filter((r) => !r.accepted);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as { reason: string }).reason).toBe(
      'partner_not_available',
    );

    // The rejected side's assignment row must have rolled back to PENDING, not been left
    // ACCEPTED — a corrupted partial state (assignment says ACCEPTED, partner never actually
    // went ON_DELIVERY for it) is exactly the "inconsistent state" this sprint exists to close.
    // results[0] is orderX's outcome, results[1] is orderY's (Promise.all preserves order).
    const rejectedAssignmentId = results[0].accepted
      ? assignmentY.id
      : assignmentX.id;
    const rejectedAssignment =
      await prisma.deliveryAssignment.findUniqueOrThrow({
        where: { id: rejectedAssignmentId },
      });
    expect(rejectedAssignment.status).toBe(AssignmentStatus.PENDING);

    const partnerRow = await prisma.deliveryPartner.findUniqueOrThrow({
      where: { id: partner.partnerId },
    });
    expect(partnerRow.status).toBe(DeliveryPartnerStatus.ON_DELIVERY);
  }, 20000);

  it('assignment expiry racing acceptance: exactly one of {accept, expire} wins, never both', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const partner = await createPartner();
    const assignment = await createPendingAssignment(
      orderId,
      partner.partnerId,
    );

    const [acceptResult, expireResult] = await Promise.all([
      dispatchRepository.acceptAssignmentAtomic({
        assignmentId: assignment.id,
        deliveryPartnerId: partner.partnerId,
        deliveryPartnerUserId: partner.userId,
        orderId,
      }),
      dispatchRepository.claimAssignmentTransition(
        assignment.id,
        [AssignmentStatus.PENDING],
        AssignmentStatus.EXPIRED,
      ),
    ]);

    // Exactly one of the two claims can have actually won the row.
    const acceptWon = acceptResult.accepted;
    const expireWon = expireResult.count === 1;
    expect(acceptWon !== expireWon).toBe(true);

    const finalAssignment = await prisma.deliveryAssignment.findUniqueOrThrow({
      where: { id: assignment.id },
    });
    expect([AssignmentStatus.ACCEPTED, AssignmentStatus.EXPIRED]).toContain(
      finalAssignment.status,
    );

    if (acceptWon) {
      expect(finalAssignment.status).toBe(AssignmentStatus.ACCEPTED);
    } else {
      expect(finalAssignment.status).toBe(AssignmentStatus.EXPIRED);
      // A losing accept must not have half-applied the partner/order claims either.
      const partnerRow = await prisma.deliveryPartner.findUniqueOrThrow({
        where: { id: partner.partnerId },
      });
      expect(partnerRow.status).toBe(DeliveryPartnerStatus.AVAILABLE);
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(order.deliveryPartnerId).toBeNull();
    }
  }, 20000);

  it('redispatch racing acceptance: creating a fresh assignment cannot succeed once the existing one is accepted', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const partnerA = await createPartner();
    const partnerB = await createPartner();
    const assignmentA = await createPendingAssignment(
      orderId,
      partnerA.partnerId,
    );

    const [acceptResult, redispatchResult] = await Promise.all([
      dispatchRepository.acceptAssignmentAtomic({
        assignmentId: assignmentA.id,
        deliveryPartnerId: partnerA.partnerId,
        deliveryPartnerUserId: partnerA.userId,
        orderId,
      }),
      dispatchRepository.createAssignmentForOrder({
        orderId,
        deliveryPartnerId: partnerB.partnerId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        dispatchableStatuses: [OrderStatus.READY_FOR_PICKUP],
      }),
    ]);

    // Whichever interleaving actually occurred, the order must end up with exactly one live
    // (PENDING/ACCEPTED) assignment — never two.
    const liveAssignments = await prisma.deliveryAssignment.count({
      where: {
        orderId,
        status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] },
      },
    });
    expect(liveAssignments).toBe(1);

    if (acceptResult.accepted) {
      expect(redispatchResult.created).toBe(false);
    }
  }, 20000);

  it('duplicate accept request for the same assignment (retry after success): first call wins, every retry cleanly reports assignment_not_pending', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const partner = await createPartner();
    const assignment = await createPendingAssignment(
      orderId,
      partner.partnerId,
    );

    const first = await dispatchRepository.acceptAssignmentAtomic({
      assignmentId: assignment.id,
      deliveryPartnerId: partner.partnerId,
      deliveryPartnerUserId: partner.userId,
      orderId,
    });
    expect(first.accepted).toBe(true);

    // Simulate a client retrying the same accept request (e.g. after a dropped response) three
    // more times, sequentially — every retry must be a clean no-op rejection, never a second
    // ON_DELIVERY transition or a second order claim.
    for (let i = 0; i < 3; i++) {
      const retry = await dispatchRepository.acceptAssignmentAtomic({
        assignmentId: assignment.id,
        deliveryPartnerId: partner.partnerId,
        deliveryPartnerUserId: partner.userId,
        orderId,
      });
      expect(retry.accepted).toBe(false);
      if (!retry.accepted) {
        expect(retry.reason).toBe('assignment_not_pending');
      }
    }

    const partnerRow = await prisma.deliveryPartner.findUniqueOrThrow({
      where: { id: partner.partnerId },
    });
    expect(partnerRow.status).toBe(DeliveryPartnerStatus.ON_DELIVERY);
  }, 20000);

  it('duplicate dispatch request for the same order (e.g. redelivered order.ready event): exactly one assignment is created', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const partners = await Promise.all([
      createPartner(),
      createPartner(),
      createPartner(),
    ]);

    const results = await Promise.all(
      partners.map((partner) =>
        dispatchRepository.createAssignmentForOrder({
          orderId,
          deliveryPartnerId: partner.partnerId,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          dispatchableStatuses: [OrderStatus.READY_FOR_PICKUP],
        }),
      ),
    );

    const created = results.filter((r) => r.created);
    expect(created).toHaveLength(1);

    const assignmentCount = await prisma.deliveryAssignment.count({
      where: { orderId },
    });
    expect(assignmentCount).toBe(1);
  }, 20000);

  it('a partner already ON_DELIVERY cannot accept a new offer — assignment claim rolls back cleanly', async () => {
    const customer = await createCustomer();
    const busyPartner = await createPartner(DeliveryPartnerStatus.ON_DELIVERY);
    const orderId = await createOrder(customer);
    const assignment = await createPendingAssignment(
      orderId,
      busyPartner.partnerId,
    );

    const result = await dispatchRepository.acceptAssignmentAtomic({
      assignmentId: assignment.id,
      deliveryPartnerId: busyPartner.partnerId,
      deliveryPartnerUserId: busyPartner.userId,
      orderId,
    });

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toBe('partner_not_available');
    }

    const finalAssignment = await prisma.deliveryAssignment.findUniqueOrThrow({
      where: { id: assignment.id },
    });
    expect(finalAssignment.status).toBe(AssignmentStatus.PENDING);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(order.deliveryPartnerId).toBeNull();
  }, 20000);

  it('releaseFromDelivery is idempotent under concurrent completion signals: exactly one call reports a real release', async () => {
    const partner = await createPartner(DeliveryPartnerStatus.ON_DELIVERY);

    const results = await Promise.all([
      deliveryRepository.releaseFromDelivery(partner.userId),
      deliveryRepository.releaseFromDelivery(partner.userId),
      deliveryRepository.releaseFromDelivery(partner.userId),
    ]);

    const realReleases = results.filter((r) => r.count === 1);
    expect(realReleases).toHaveLength(1);

    const partnerRow = await prisma.deliveryPartner.findUniqueOrThrow({
      where: { id: partner.partnerId },
    });
    expect(partnerRow.status).toBe(DeliveryPartnerStatus.AVAILABLE);
  }, 20000);

  it('releaseFromDelivery never pulls an OFFLINE/SUSPENDED partner back to AVAILABLE', async () => {
    const offlinePartner = await createPartner(DeliveryPartnerStatus.OFFLINE);
    const suspendedPartner = await createPartner(
      DeliveryPartnerStatus.SUSPENDED,
    );

    const offlineResult = await deliveryRepository.releaseFromDelivery(
      offlinePartner.userId,
    );
    const suspendedResult = await deliveryRepository.releaseFromDelivery(
      suspendedPartner.userId,
    );

    expect(offlineResult.count).toBe(0);
    expect(suspendedResult.count).toBe(0);

    const offlineRow = await prisma.deliveryPartner.findUniqueOrThrow({
      where: { id: offlinePartner.partnerId },
    });
    const suspendedRow = await prisma.deliveryPartner.findUniqueOrThrow({
      where: { id: suspendedPartner.partnerId },
    });
    expect(offlineRow.status).toBe(DeliveryPartnerStatus.OFFLINE);
    expect(suspendedRow.status).toBe(DeliveryPartnerStatus.SUSPENDED);
  }, 20000);

  it('reject and accept racing the same assignment: exactly one wins, no assignment is left in a mixed state', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const partner = await createPartner();
    const assignment = await createPendingAssignment(
      orderId,
      partner.partnerId,
    );

    const [acceptResult, rejectResult] = await Promise.all([
      dispatchRepository.acceptAssignmentAtomic({
        assignmentId: assignment.id,
        deliveryPartnerId: partner.partnerId,
        deliveryPartnerUserId: partner.userId,
        orderId,
      }),
      dispatchRepository.claimAssignmentTransition(
        assignment.id,
        [AssignmentStatus.PENDING],
        AssignmentStatus.REJECTED,
      ),
    ]);

    const acceptWon = acceptResult.accepted;
    const rejectWon = rejectResult.count === 1;
    expect(acceptWon !== rejectWon).toBe(true);

    const finalAssignment = await prisma.deliveryAssignment.findUniqueOrThrow({
      where: { id: assignment.id },
    });
    expect([AssignmentStatus.ACCEPTED, AssignmentStatus.REJECTED]).toContain(
      finalAssignment.status,
    );
  }, 20000);

  it('createAssignmentForOrder refuses to create a second assignment once the order already has a partner', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const partnerA = await createPartner();
    const partnerB = await createPartner();

    await prisma.order.update({
      where: { id: orderId },
      data: { deliveryPartnerId: partnerA.userId },
    });

    const result = await dispatchRepository.createAssignmentForOrder({
      orderId,
      deliveryPartnerId: partnerB.partnerId,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      dispatchableStatuses: [OrderStatus.READY_FOR_PICKUP],
    });

    expect(result.created).toBe(false);
    if (!result.created) {
      expect(result.reason).toBe('already_has_partner');
    }

    const assignmentCount = await prisma.deliveryAssignment.count({
      where: { orderId },
    });
    expect(assignmentCount).toBe(0);
  }, 20000);

  it('createAssignmentForOrder refuses to create an assignment for a non-dispatchable order status', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer, OrderStatus.PREPARING);
    const partner = await createPartner();

    const result = await dispatchRepository.createAssignmentForOrder({
      orderId,
      deliveryPartnerId: partner.partnerId,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      dispatchableStatuses: [OrderStatus.READY_FOR_PICKUP],
    });

    expect(result.created).toBe(false);
    if (!result.created) {
      expect(result.reason).toBe('not_dispatchable');
    }
  }, 20000);
});
