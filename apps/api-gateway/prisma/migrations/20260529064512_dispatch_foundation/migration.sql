-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'ASSIGNED', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "delivery_assignments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "deliveryPartnerId" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_assignments_orderId_idx" ON "delivery_assignments"("orderId");

-- CreateIndex
CREATE INDEX "delivery_assignments_deliveryPartnerId_idx" ON "delivery_assignments"("deliveryPartnerId");

-- CreateIndex
CREATE INDEX "delivery_assignments_status_idx" ON "delivery_assignments"("status");

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_deliveryPartnerId_fkey" FOREIGN KEY ("deliveryPartnerId") REFERENCES "delivery_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
