-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('PETROL', 'DIESEL', 'ELECTRIC', 'CNG', 'HYBRID');

-- CreateEnum
CREATE TYPE "DeliveryDocumentType" AS ENUM ('DRIVING_LICENSE', 'AADHAAR', 'PAN', 'VEHICLE_RC', 'VEHICLE_INSURANCE', 'VEHICLE_FITNESS', 'VEHICLE_POLLUTION', 'PROFILE_PHOTO', 'SELFIE', 'BACKGROUND_VERIFICATION', 'VEHICLE_PHOTO', 'OTHER');

-- CreateEnum
CREATE TYPE "DeliveryVerificationStage" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DeliveryOnboardingStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ComplianceOverallStatus" AS ENUM ('COMPLIANT', 'AT_RISK', 'NON_COMPLIANT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'DELIVERY_PARTNER_VERIFICATION_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'DELIVERY_PARTNER_VERIFICATION_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'DELIVERY_PARTNER_VERIFICATION_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'DELIVERY_PARTNER_CHANGES_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'DELIVERY_PARTNER_DOCUMENT_EXPIRING';

-- AlterEnum
ALTER TYPE "VehicleType" ADD VALUE 'ELECTRIC_VEHICLE';

-- AlterTable
ALTER TABLE "delivery_partners" ADD COLUMN     "currentAddressLatitude" DOUBLE PRECISION,
ADD COLUMN     "currentAddressLine1" TEXT,
ADD COLUMN     "currentAddressLine2" TEXT,
ADD COLUMN     "currentAddressLongitude" DOUBLE PRECISION,
ADD COLUMN     "currentCity" TEXT,
ADD COLUMN     "currentPostalCode" TEXT,
ADD COLUMN     "currentState" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT,
ADD COLUMN     "emergencyContactRelation" TEXT,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "languagesSpoken" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "permanentAddressLine1" TEXT,
ADD COLUMN     "permanentAddressLine2" TEXT,
ADD COLUMN     "permanentCity" TEXT,
ADD COLUMN     "permanentLatitude" DOUBLE PRECISION,
ADD COLUMN     "permanentLongitude" DOUBLE PRECISION,
ADD COLUMN     "permanentPostalCode" TEXT,
ADD COLUMN     "permanentState" TEXT,
ADD COLUMN     "sameAsPermanentAddress" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "delivery_vehicles" (
    "id" TEXT NOT NULL,
    "deliveryPartnerId" TEXT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "fuelType" "FuelType",
    "color" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "insuranceExpiryAt" TIMESTAMP(3),
    "rcExpiryAt" TIMESTAMP(3),
    "fitnessExpiryAt" TIMESTAMP(3),
    "pollutionExpiryAt" TIMESTAMP(3),
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_documents" (
    "id" TEXT NOT NULL,
    "deliveryPartnerId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "documentType" "DeliveryDocumentType" NOT NULL,
    "documentNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "storageUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "previousVersionId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_document_versions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "deliveryPartnerId" TEXT NOT NULL,
    "documentType" "DeliveryDocumentType" NOT NULL,
    "version" INTEGER NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_bank_accounts" (
    "id" TEXT NOT NULL,
    "deliveryPartnerId" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "branchName" TEXT,
    "accountNumberEncrypted" TEXT NOT NULL,
    "accountNumberLast4" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "upiId" TEXT,
    "cancelledChequeDocumentId" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "payoutProviderRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_verifications" (
    "id" TEXT NOT NULL,
    "deliveryPartnerId" TEXT NOT NULL,
    "stage" "DeliveryVerificationStage" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "rejectedReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_verification_history" (
    "id" TEXT NOT NULL,
    "deliveryPartnerId" TEXT NOT NULL,
    "fromStage" "DeliveryVerificationStage",
    "toStage" "DeliveryVerificationStage" NOT NULL,
    "reason" TEXT,
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_verification_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_onboardings" (
    "id" TEXT NOT NULL,
    "deliveryPartnerId" TEXT NOT NULL,
    "status" "DeliveryOnboardingStatus" NOT NULL DEFAULT 'DRAFT',
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "completedSteps" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "termsAcceptedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "changesRequested" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_onboardings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_compliance_snapshots" (
    "id" TEXT NOT NULL,
    "deliveryPartnerId" TEXT NOT NULL,
    "overallStatus" "ComplianceOverallStatus" NOT NULL,
    "verificationStage" "DeliveryVerificationStage" NOT NULL,
    "documentsTotal" INTEGER NOT NULL DEFAULT 0,
    "documentsVerified" INTEGER NOT NULL DEFAULT 0,
    "documentsPending" INTEGER NOT NULL DEFAULT 0,
    "documentsRejected" INTEGER NOT NULL DEFAULT 0,
    "bankVerificationStatus" "VerificationStatus",
    "missingDocumentTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_compliance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_vehicles_deliveryPartnerId_idx" ON "delivery_vehicles"("deliveryPartnerId");

-- CreateIndex
CREATE INDEX "delivery_vehicles_isActive_idx" ON "delivery_vehicles"("isActive");

-- CreateIndex
CREATE INDEX "delivery_documents_deliveryPartnerId_idx" ON "delivery_documents"("deliveryPartnerId");

-- CreateIndex
CREATE INDEX "delivery_documents_vehicleId_idx" ON "delivery_documents"("vehicleId");

-- CreateIndex
CREATE INDEX "delivery_documents_documentType_idx" ON "delivery_documents"("documentType");

-- CreateIndex
CREATE INDEX "delivery_documents_status_idx" ON "delivery_documents"("status");

-- CreateIndex
CREATE INDEX "delivery_documents_expiryDate_idx" ON "delivery_documents"("expiryDate");

-- CreateIndex
CREATE INDEX "delivery_document_versions_documentId_idx" ON "delivery_document_versions"("documentId");

-- CreateIndex
CREATE INDEX "delivery_document_versions_deliveryPartnerId_idx" ON "delivery_document_versions"("deliveryPartnerId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_bank_accounts_deliveryPartnerId_key" ON "delivery_bank_accounts"("deliveryPartnerId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_verifications_deliveryPartnerId_key" ON "delivery_verifications"("deliveryPartnerId");

-- CreateIndex
CREATE INDEX "delivery_verifications_stage_idx" ON "delivery_verifications"("stage");

-- CreateIndex
CREATE INDEX "delivery_verification_history_deliveryPartnerId_idx" ON "delivery_verification_history"("deliveryPartnerId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_onboardings_deliveryPartnerId_key" ON "delivery_onboardings"("deliveryPartnerId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_compliance_snapshots_deliveryPartnerId_key" ON "delivery_compliance_snapshots"("deliveryPartnerId");

-- AddForeignKey
ALTER TABLE "delivery_vehicles" ADD CONSTRAINT "delivery_vehicles_deliveryPartnerId_fkey" FOREIGN KEY ("deliveryPartnerId") REFERENCES "delivery_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_documents" ADD CONSTRAINT "delivery_documents_deliveryPartnerId_fkey" FOREIGN KEY ("deliveryPartnerId") REFERENCES "delivery_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_documents" ADD CONSTRAINT "delivery_documents_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "delivery_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_bank_accounts" ADD CONSTRAINT "delivery_bank_accounts_deliveryPartnerId_fkey" FOREIGN KEY ("deliveryPartnerId") REFERENCES "delivery_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_verifications" ADD CONSTRAINT "delivery_verifications_deliveryPartnerId_fkey" FOREIGN KEY ("deliveryPartnerId") REFERENCES "delivery_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_onboardings" ADD CONSTRAINT "delivery_onboardings_deliveryPartnerId_fkey" FOREIGN KEY ("deliveryPartnerId") REFERENCES "delivery_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_compliance_snapshots" ADD CONSTRAINT "delivery_compliance_snapshots_deliveryPartnerId_fkey" FOREIGN KEY ("deliveryPartnerId") REFERENCES "delivery_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
