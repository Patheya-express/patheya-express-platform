-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'RIDER_ARRIVED_AT_RESTAURANT';

-- DropForeignKey
ALTER TABLE "delivery_parcel_confirmations" DROP CONSTRAINT "delivery_parcel_confirmations_orderId_fkey";

-- AlterTable
ALTER TABLE "delivery_assignments" ADD COLUMN     "arrivedAtRestaurantAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "delivery_parcel_confirmations";

