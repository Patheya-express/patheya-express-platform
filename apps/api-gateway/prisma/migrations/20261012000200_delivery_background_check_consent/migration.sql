-- Background-check consent for delivery onboarding (2026-10-12). Additive, nullable column.
ALTER TABLE "delivery_onboardings" ADD COLUMN "backgroundCheckConsentAt" TIMESTAMP(3);
