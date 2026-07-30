-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "orderUpdatesEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "orderUpdatesPush" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "orderUpdatesSms" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "promotionsEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "promotionsPush" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "promotionsSms" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewsEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reviewsPush" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reviewsSms" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "systemEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "systemPush" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "systemSms" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "themePreference" "ThemePreference" NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- CreateTable
CREATE TABLE "restaurant_favorites" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item_favorites" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_item_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restaurant_favorites_restaurantId_idx" ON "restaurant_favorites"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_favorites_customerId_restaurantId_key" ON "restaurant_favorites"("customerId", "restaurantId");

-- CreateIndex
CREATE INDEX "menu_item_favorites_menuItemId_idx" ON "menu_item_favorites"("menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "menu_item_favorites_customerId_menuItemId_key" ON "menu_item_favorites"("customerId", "menuItemId");

-- AddForeignKey
ALTER TABLE "restaurant_favorites" ADD CONSTRAINT "restaurant_favorites_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_favorites" ADD CONSTRAINT "restaurant_favorites_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_favorites" ADD CONSTRAINT "menu_item_favorites_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_favorites" ADD CONSTRAINT "menu_item_favorites_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
