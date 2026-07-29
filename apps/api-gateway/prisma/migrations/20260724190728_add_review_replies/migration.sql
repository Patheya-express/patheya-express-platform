-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_REPLIED';

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "repliedByUserId" TEXT,
ADD COLUMN     "replyCreatedAt" TIMESTAMP(3),
ADD COLUMN     "replyText" TEXT,
ADD COLUMN     "replyUpdatedAt" TIMESTAMP(3);
