import {
  PrismaClient,
  UserRole,
  UserStatus,
  AuthProvider,
  VehicleType,
  DeliveryPartnerStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const RIDERS = [
  { firstName: 'Arjun', lastName: 'Rider', email: 'rider1@patheyaexpress.com', vehicleType: VehicleType.BIKE, vehicleNumber: 'KA-01-AB-1001', licenseNumber: 'DL-RIDER-001' },
  { firstName: 'Vikram', lastName: 'Rider', email: 'rider2@patheyaexpress.com', vehicleType: VehicleType.SCOOTER, vehicleNumber: 'KA-01-AB-1002', licenseNumber: 'DL-RIDER-002' },
  { firstName: 'Sanjay', lastName: 'Rider', email: 'rider3@patheyaexpress.com', vehicleType: VehicleType.BICYCLE, vehicleNumber: 'KA-01-AB-1003', licenseNumber: 'DL-RIDER-003' },
  { firstName: 'Karthik', lastName: 'Rider', email: 'rider4@patheyaexpress.com', vehicleType: VehicleType.BIKE, vehicleNumber: 'KA-01-AB-1004', licenseNumber: 'DL-RIDER-004' },
  { firstName: 'Naveen', lastName: 'Rider', email: 'rider5@patheyaexpress.com', vehicleType: VehicleType.SCOOTER, vehicleNumber: 'KA-01-AB-1005', licenseNumber: 'DL-RIDER-005' },
];

export async function seedDeliveryPartners(prisma: PrismaClient): Promise<void> {
  console.log('🛵 Seeding delivery partners...');

  const passwordHash = await bcrypt.hash('Patheya@123', 10);

  for (const rider of RIDERS) {
    const user = await prisma.user.upsert({
      where: {
        email: rider.email,
      },

      update: {},

      create: {
        firstName: rider.firstName,
        lastName: rider.lastName,
        email: rider.email,
        role: UserRole.DELIVERY_PARTNER,

        passwordHash,

        provider: AuthProvider.EMAIL,

        status: UserStatus.ACTIVE,

        isEmailVerified: true,
      },
    });

    await prisma.deliveryPartner.upsert({
      where: {
        userId: user.id,
      },

      update: {
        status: DeliveryPartnerStatus.AVAILABLE,

        isVerified: true,
      },

      create: {
        userId: user.id,

        vehicleType: rider.vehicleType,
        vehicleNumber: rider.vehicleNumber,
        licenseNumber: rider.licenseNumber,

        status: DeliveryPartnerStatus.AVAILABLE,

        isVerified: true,
      },
    });
  }

  console.log(`✅ ${RIDERS.length} delivery partners seeded (all AVAILABLE).`);
}
