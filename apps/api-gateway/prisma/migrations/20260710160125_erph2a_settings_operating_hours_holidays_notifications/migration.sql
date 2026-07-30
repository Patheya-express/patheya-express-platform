-- CreateEnum
CREATE TYPE "ServiceChargeType" AS ENUM ('NONE', 'FLAT', 'PERCENTAGE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'NEW_ORDER_FOR_RESTAURANT';
ALTER TYPE "NotificationType" ADD VALUE 'ORDER_CANCELLED_FOR_RESTAURANT';
ALTER TYPE "NotificationType" ADD VALUE 'REFUND_FOR_RESTAURANT';
ALTER TYPE "NotificationType" ADD VALUE 'CUSTOMER_MESSAGE_FOR_RESTAURANT';

-- AlterTable
ALTER TABLE "order_status_history" ADD COLUMN     "changedById" TEXT;

-- CreateTable
CREATE TABLE "restaurant_holidays" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT true,
    "specialOpensAt" TEXT,
    "specialClosesAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_settings" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "serviceChargeType" "ServiceChargeType" NOT NULL DEFAULT 'NONE',
    "serviceChargeValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "packingChargeType" "ServiceChargeType" NOT NULL DEFAULT 'NONE',
    "packingChargeValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "minimumOrderAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "autoAcceptOrders" BOOLEAN NOT NULL DEFAULT false,
    "acceptanceTimeoutMinutes" INTEGER NOT NULL DEFAULT 10,
    "isTemporarilyClosed" BOOLEAN NOT NULL DEFAULT false,
    "temporaryClosureReason" TEXT,
    "temporaryClosureUntil" TIMESTAMP(3),
    "restaurantNotes" TEXT,
    "specialInstructions" TEXT,
    "deliveryRadiusOverrideKm" DECIMAL(6,2),
    "orderPreparationDefaultMinutes" INTEGER,
    "notifyOnNewOrder" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnOrderCancelled" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnRefund" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnCustomerMessage" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restaurant_holidays_restaurantId_idx" ON "restaurant_holidays"("restaurantId");

-- CreateIndex
CREATE INDEX "restaurant_holidays_branchId_idx" ON "restaurant_holidays"("branchId");

-- CreateIndex
CREATE INDEX "restaurant_holidays_date_idx" ON "restaurant_holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_holidays_restaurantId_branchId_date_key" ON "restaurant_holidays"("restaurantId", "branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_settings_restaurantId_key" ON "restaurant_settings"("restaurantId");

-- CreateIndex
CREATE INDEX "operating_hours_branchId_dayOfWeek_idx" ON "operating_hours"("branchId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "restaurant_holidays" ADD CONSTRAINT "restaurant_holidays_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_holidays" ADD CONSTRAINT "restaurant_holidays_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "restaurant_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_settings" ADD CONSTRAINT "restaurant_settings_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
