-- CreateEnum
CREATE TYPE "DeliveryProofType" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "DeliveryProofOtpStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'EXCEEDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'PICKUP_OTP_GENERATED';
ALTER TYPE "NotificationType" ADD VALUE 'DELIVERY_OTP_GENERATED';
ALTER TYPE "NotificationType" ADD VALUE 'PICKUP_VERIFIED';
ALTER TYPE "NotificationType" ADD VALUE 'DELIVERY_VERIFIED';

-- CreateTable
CREATE TABLE "delivery_proof_otps" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "DeliveryProofType" NOT NULL,
    "otpHash" TEXT NOT NULL,
    "status" "DeliveryProofOtpStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_proof_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_proof_otps_orderId_type_key" ON "delivery_proof_otps"("orderId", "type");

-- AddForeignKey
ALTER TABLE "delivery_proof_otps" ADD CONSTRAINT "delivery_proof_otps_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
