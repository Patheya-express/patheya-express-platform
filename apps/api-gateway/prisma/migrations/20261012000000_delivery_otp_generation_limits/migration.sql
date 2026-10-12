-- Delivery OTP hardening (2026-10-12): backend-enforced resend cooldown and per-order issue cap.
-- Additive only — existing rows count as one issued code, generated at migration time.
ALTER TABLE "delivery_proof_otps"
  ADD COLUMN "generationCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lastGeneratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
