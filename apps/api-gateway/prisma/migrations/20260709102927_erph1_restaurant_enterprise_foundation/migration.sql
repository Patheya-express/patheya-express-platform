-- CreateEnum
CREATE TYPE "RestaurantStaffRole" AS ENUM ('OWNER', 'CO_OWNER', 'BRANCH_MANAGER', 'KITCHEN_MANAGER', 'FINANCE_MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "RestaurantStaffStatus" AS ENUM ('INVITED', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "RestaurantVerificationStage" AS ENUM ('DRAFT', 'SUBMITTED', 'DOCUMENT_REVIEW', 'GST_VERIFICATION', 'FSSAI_VERIFICATION', 'BANK_VERIFICATION', 'COMPLIANCE_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RestaurantDocumentType" AS ENUM ('GST', 'FSSAI', 'PAN', 'TRADE_LICENSE', 'FIRE_NOC', 'SHOP_ESTABLISHMENT', 'LIQUOR_LICENSE', 'HALAL', 'CANCELLED_CHEQUE', 'PASSBOOK', 'AADHAAR', 'PAN_CARD', 'RENTAL_AGREEMENT', 'UTILITY_BILL', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'TRUST', 'SOCIETY', 'OTHER');

-- CreateEnum
CREATE TYPE "RestaurantMediaType" AS ENUM ('LOGO', 'BANNER', 'FRONT_VIEW', 'EXTERIOR', 'KITCHEN', 'DINING', 'INTERIOR', 'SIGN_BOARD', 'GALLERY', 'VIDEO');

-- DropIndex
DROP INDEX "cuisines_name_trgm_idx";

-- DropIndex
DROP INDEX "menu_items_name_trgm_idx";

-- DropIndex
DROP INDEX "restaurants_description_trgm_idx";

-- DropIndex
DROP INDEX "restaurants_name_trgm_idx";

-- AlterTable
ALTER TABLE "menu_categories" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "restaurant_branches" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryRadiusKm" DOUBLE PRECISION,
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT,
ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "landmark" TEXT,
ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "brandName" TEXT,
ADD COLUMN     "businessEmail" TEXT,
ADD COLUMN     "businessId" TEXT,
ADD COLUMN     "businessPhone" TEXT,
ADD COLUMN     "legalBusinessName" TEXT,
ADD COLUMN     "supportEmail" TEXT,
ADD COLUMN     "supportPhone" TEXT,
ADD COLUMN     "tradeName" TEXT,
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "restaurant_staff" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT,
    "role" "RestaurantStaffRole" NOT NULL DEFAULT 'STAFF',
    "status" "RestaurantStaffStatus" NOT NULL DEFAULT 'INVITED',
    "invitedById" TEXT,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_verifications" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "stage" "RestaurantVerificationStage" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "rejectedReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_documents" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT,
    "documentType" "RestaurantDocumentType" NOT NULL,
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

    CONSTRAINT "restaurant_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_tax_profiles" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "gstin" TEXT,
    "gstLegalName" TEXT,
    "gstRegisteredAddress" TEXT,
    "gstBusinessCategory" TEXT,
    "gstRegistrationState" TEXT,
    "gstVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "gstVerifiedById" TEXT,
    "gstVerifiedAt" TIMESTAMP(3),
    "fssaiNumber" TEXT,
    "fssaiLicenseType" TEXT,
    "fssaiIssueDate" TIMESTAMP(3),
    "fssaiExpiryAt" TIMESTAMP(3),
    "fssaiVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "fssaiVerifiedById" TEXT,
    "fssaiVerifiedAt" TIMESTAMP(3),
    "pan" TEXT,
    "cin" TEXT,
    "businessType" "BusinessType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_bank_accounts" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
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

    CONSTRAINT "restaurant_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_media" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT,
    "type" "RestaurantMediaType" NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restaurant_staff_restaurantId_idx" ON "restaurant_staff"("restaurantId");

-- CreateIndex
CREATE INDEX "restaurant_staff_userId_idx" ON "restaurant_staff"("userId");

-- CreateIndex
CREATE INDEX "restaurant_staff_branchId_idx" ON "restaurant_staff"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_staff_restaurantId_userId_key" ON "restaurant_staff"("restaurantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_verifications_restaurantId_key" ON "restaurant_verifications"("restaurantId");

-- CreateIndex
CREATE INDEX "restaurant_verifications_stage_idx" ON "restaurant_verifications"("stage");

-- CreateIndex
CREATE INDEX "restaurant_documents_restaurantId_idx" ON "restaurant_documents"("restaurantId");

-- CreateIndex
CREATE INDEX "restaurant_documents_branchId_idx" ON "restaurant_documents"("branchId");

-- CreateIndex
CREATE INDEX "restaurant_documents_documentType_idx" ON "restaurant_documents"("documentType");

-- CreateIndex
CREATE INDEX "restaurant_documents_status_idx" ON "restaurant_documents"("status");

-- CreateIndex
CREATE INDEX "restaurant_documents_expiryDate_idx" ON "restaurant_documents"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_tax_profiles_restaurantId_key" ON "restaurant_tax_profiles"("restaurantId");

-- CreateIndex
CREATE INDEX "restaurant_tax_profiles_fssaiExpiryAt_idx" ON "restaurant_tax_profiles"("fssaiExpiryAt");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_bank_accounts_restaurantId_key" ON "restaurant_bank_accounts"("restaurantId");

-- CreateIndex
CREATE INDEX "restaurant_media_restaurantId_idx" ON "restaurant_media"("restaurantId");

-- CreateIndex
CREATE INDEX "restaurant_media_branchId_idx" ON "restaurant_media"("branchId");

-- CreateIndex
CREATE INDEX "restaurant_media_type_idx" ON "restaurant_media"("type");

-- CreateIndex
CREATE INDEX "menu_categories_branchId_idx" ON "menu_categories"("branchId");

-- CreateIndex
CREATE INDEX "restaurant_branches_isPrimary_idx" ON "restaurant_branches"("isPrimary");

-- CreateIndex
CREATE INDEX "restaurants_businessId_idx" ON "restaurants"("businessId");

-- AddForeignKey
ALTER TABLE "restaurant_staff" ADD CONSTRAINT "restaurant_staff_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_staff" ADD CONSTRAINT "restaurant_staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_staff" ADD CONSTRAINT "restaurant_staff_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "restaurant_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_verifications" ADD CONSTRAINT "restaurant_verifications_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_documents" ADD CONSTRAINT "restaurant_documents_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_documents" ADD CONSTRAINT "restaurant_documents_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "restaurant_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_tax_profiles" ADD CONSTRAINT "restaurant_tax_profiles_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_bank_accounts" ADD CONSTRAINT "restaurant_bank_accounts_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_media" ADD CONSTRAINT "restaurant_media_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_media" ADD CONSTRAINT "restaurant_media_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "restaurant_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "restaurant_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
