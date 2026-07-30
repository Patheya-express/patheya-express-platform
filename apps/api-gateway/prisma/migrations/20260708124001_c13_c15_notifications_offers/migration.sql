-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('PERCENTAGE_OFF', 'FLAT_OFF', 'FREE_DELIVERY', 'BUY_ONE_GET_ONE', 'CASHBACK', 'OTHER');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'OFFER';

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "type" "OfferType";

-- CreateIndex
CREATE INDEX "offers_type_idx" ON "offers"("type");
