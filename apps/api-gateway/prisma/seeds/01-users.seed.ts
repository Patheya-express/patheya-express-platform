import {
  PrismaClient,
  UserRole,
  UserStatus,
  AuthProvider,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

export async function seedUsers(prisma: PrismaClient): Promise<void> {
  console.log('👤 Seeding users...');

  const passwordHash = await bcrypt.hash('Patheya@123', 10);

  const users = [
    {
      firstName: 'Super',
      lastName: 'Admin',
      email: 'superadmin@patheyaexpress.com',
      role: UserRole.SUPER_ADMIN,
    },
    {
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@patheyaexpress.com',
      role: UserRole.ADMIN,
    },
    {
      firstName: 'Restaurant',
      lastName: 'Owner',
      email: 'owner@patheyaexpress.com',
      role: UserRole.RESTAURANT_OWNER,
    },
    {
      firstName: 'Customer',
      lastName: 'User',
      email: 'customer@patheyaexpress.com',
      role: UserRole.CUSTOMER,
    },
    {
      firstName: 'Delivery',
      lastName: 'Partner',
      email: 'delivery@patheyaexpress.com',
      role: UserRole.DELIVERY_PARTNER,
    },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: {
        email: user.email,
      },

      update: {},

      create: {
        ...user,

        passwordHash,

        provider: AuthProvider.EMAIL,

        status: UserStatus.ACTIVE,

        isEmailVerified: true,
      },
    });
  }

  console.log(`✅ ${users.length} users seeded.`);
}
