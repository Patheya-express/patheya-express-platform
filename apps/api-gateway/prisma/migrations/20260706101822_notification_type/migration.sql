-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ORDER_PLACED', 'ORDER_STATUS_CHANGED', 'DELIVERY_PARTNER_ASSIGNED', 'GENERAL');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "type" "NotificationType" NOT NULL DEFAULT 'GENERAL';

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "notifications"("type");
