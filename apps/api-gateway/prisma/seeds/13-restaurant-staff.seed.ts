import {
  AuthProvider,
  PrismaClient,
  RestaurantStaffRole,
  RestaurantStaffStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { FLAGSHIP_RESTAURANT_SLUGS } from './erph2a-flagship-restaurants';

interface StaffTemplate {
  emailSuffix: string;
  firstName: string;
  lastName: string;
  role: RestaurantStaffRole;
  /** Which branch (by index into the restaurant's branches, ordered by isPrimary desc then
   *  createdAt) this staff member is scoped to. Undefined = restaurant-wide. */
  branchIndex?: number;
}

const STAFF_TEMPLATE: StaffTemplate[] = [
  { emailSuffix: 'coowner', firstName: 'Co', lastName: 'Owner', role: RestaurantStaffRole.CO_OWNER },
  { emailSuffix: 'finance', firstName: 'Finance', lastName: 'Manager', role: RestaurantStaffRole.FINANCE_MANAGER },
  { emailSuffix: 'manager1', firstName: 'Branch', lastName: 'Manager One', role: RestaurantStaffRole.BRANCH_MANAGER, branchIndex: 1 },
  { emailSuffix: 'manager2', firstName: 'Branch', lastName: 'Manager Two', role: RestaurantStaffRole.BRANCH_MANAGER, branchIndex: 2 },
  { emailSuffix: 'staff', firstName: 'Front', lastName: 'Desk Staff', role: RestaurantStaffRole.STAFF, branchIndex: 0 },
];

export async function seedRestaurantStaff(prisma: PrismaClient): Promise<void> {
  console.log('🧑‍🍳 Seeding restaurant staff...');

  const passwordHash = await bcrypt.hash('Patheya@123', 10);

  let staffCount = 0;

  for (const slug of FLAGSHIP_RESTAURANT_SLUGS) {
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true, ownerId: true },
    });

    if (!restaurant) {
      continue;
    }

    const branches = await prisma.restaurantBranch.findMany({
      where: { restaurantId: restaurant.id },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });

    for (const template of STAFF_TEMPLATE) {
      const email = `${slug}-${template.emailSuffix}@patheyaexpress.com`;

      const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
          firstName: template.firstName,
          lastName: template.lastName,
          email,
          role: UserRole.RESTAURANT_MANAGER,
          passwordHash,
          provider: AuthProvider.EMAIL,
          status: UserStatus.ACTIVE,
          isEmailVerified: true,
        },
      });

      const branchId =
        template.branchIndex !== undefined ? branches[template.branchIndex]?.id : undefined;

      await prisma.restaurantStaff.upsert({
        where: {
          restaurantId_userId: { restaurantId: restaurant.id, userId: user.id },
        },
        update: {},
        create: {
          restaurantId: restaurant.id,
          userId: user.id,
          branchId,
          role: template.role,
          status: RestaurantStaffStatus.ACTIVE,
          invitedById: restaurant.ownerId,
          respondedAt: new Date(),
        },
      });

      staffCount++;
    }
  }

  console.log(`✅ ${staffCount} restaurant staff members seeded across ${FLAGSHIP_RESTAURANT_SLUGS.length} restaurants.`);
}
