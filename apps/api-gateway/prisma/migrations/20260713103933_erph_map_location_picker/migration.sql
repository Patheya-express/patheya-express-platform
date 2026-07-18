-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('GPS', 'MANUAL', 'AUTOCOMPLETE', 'REVERSE_GEOCODE', 'MAP_CLICK', 'MARKER_DRAG');

-- CreateEnum
CREATE TYPE "MapProvider" AS ENUM ('GOOGLE_MAPS', 'MAPBOX', 'HERE_MAPS', 'OPENSTREETMAP', 'AZURE_MAPS');

-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "accuracy" DOUBLE PRECISION,
ADD COLUMN     "altitude" DOUBLE PRECISION,
ADD COLUMN     "heading" DOUBLE PRECISION,
ADD COLUMN     "locationSource" "LocationSource",
ADD COLUMN     "provider" "MapProvider",
ADD COLUMN     "providerMetadata" JSONB,
ADD COLUMN     "providerPlaceId" TEXT,
ADD COLUMN     "speed" DOUBLE PRECISION,
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);
