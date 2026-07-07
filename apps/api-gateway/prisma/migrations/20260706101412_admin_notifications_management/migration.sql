-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- Backfill existing rows so updatedAt starts out consistent with when they were created
UPDATE "notifications" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "updatedAt" SET NOT NULL;
