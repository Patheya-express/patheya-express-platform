-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PARCEL_CONFIRMED';

-- CreateTable
CREATE TABLE "delivery_proof_photos" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "DeliveryProofType" NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_proof_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_parcel_confirmations" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_parcel_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_proof_photos_orderId_type_key" ON "delivery_proof_photos"("orderId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_parcel_confirmations_orderId_key" ON "delivery_parcel_confirmations"("orderId");

-- AddForeignKey
ALTER TABLE "delivery_proof_photos" ADD CONSTRAINT "delivery_proof_photos_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_parcel_confirmations" ADD CONSTRAINT "delivery_parcel_confirmations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
