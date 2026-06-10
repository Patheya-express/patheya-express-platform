/*
  Warnings:

  - A unique constraint covering the columns `[providerOrderId]` on the table `payments` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "payments_orderId_key";

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "attemptNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerOrderId_key" ON "payments"("providerOrderId");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "payments_isActive_idx" ON "payments"("isActive");

-- CreateIndex
CREATE INDEX "payments_attemptNumber_idx" ON "payments"("attemptNumber");
