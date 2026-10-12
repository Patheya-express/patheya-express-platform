import { DeliveryDocumentType, Gender } from '@prisma/client';

/** What OnboardingRepository.findStepEvidence returns for a partner. */
export interface OnboardingStepEvidence {
  dateOfBirth: Date | null;
  gender: Gender | null;
  languagesSpoken: string[];
  currentAddressLine1: string | null;
  currentCity: string | null;
  currentState: string | null;
  currentPostalCode: string | null;
  currentAddressLatitude: number | null;
  currentAddressLongitude: number | null;
  vehicles: Array<{ id: string }>;
  documents: Array<{ documentType: DeliveryDocumentType }>;
  bankAccount: { deliveryPartnerId: string } | null;
  onboarding: { backgroundCheckConsentAt: Date | null } | null;
}

/** Wizard steps 4–8 and 10 are each satisfied by one uploaded document type. */
const STEP_DOCUMENT: Partial<
  Record<number, { type: DeliveryDocumentType; label: string }>
> = {
  4: { type: DeliveryDocumentType.DRIVING_LICENSE, label: 'driving licence' },
  5: { type: DeliveryDocumentType.AADHAAR, label: 'Aadhaar' },
  6: { type: DeliveryDocumentType.PAN, label: 'PAN card' },
  7: { type: DeliveryDocumentType.VEHICLE_RC, label: 'vehicle RC' },
  8: {
    type: DeliveryDocumentType.VEHICLE_INSURANCE,
    label: 'vehicle insurance',
  },
  10: { type: DeliveryDocumentType.SELFIE, label: 'selfie' },
};

/**
 * Steps whose data the backend can check — every step before submission. Step 11 is satisfied by
 * the recorded background-check consent (its police-clearance upload stays optional); step 12 is
 * the act of submitting itself.
 */
export const VERIFIABLE_ONBOARDING_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function blank(value: string | null): boolean {
  return !value || !value.trim();
}

/**
 * 2026-10-12 — the backend used to mark any wizard step complete on request, so a client could
 * mark steps 1–11 done and submit an empty application (only the admin review stood in the way).
 * Returns why `step` isn't satisfied yet, or null when it is. Mirrors exactly what each wizard step
 * already requires on the client — no new mandatory fields.
 */
export function missingOnboardingStepRequirement(
  step: number,
  evidence: OnboardingStepEvidence,
): string | null {
  switch (step) {
    case 1:
      if (!evidence.dateOfBirth || !evidence.gender) {
        return 'Add your date of birth and gender first';
      }
      if (!evidence.languagesSpoken.some((language) => language.trim())) {
        return 'Add at least one language you speak first';
      }
      return null;

    case 2:
      if (
        blank(evidence.currentAddressLine1) ||
        blank(evidence.currentCity) ||
        blank(evidence.currentState) ||
        blank(evidence.currentPostalCode)
      ) {
        return 'Add your current address first';
      }
      // 0/0 is the wizard's "nothing picked" default, never a real address in India.
      if (
        evidence.currentAddressLatitude == null ||
        evidence.currentAddressLongitude == null ||
        (evidence.currentAddressLatitude === 0 &&
          evidence.currentAddressLongitude === 0)
      ) {
        return 'Pick your current address location on the map first';
      }
      return null;

    case 3:
      return evidence.vehicles.length > 0
        ? null
        : 'Register your vehicle first';

    case 9:
      return evidence.bankAccount ? null : 'Add your bank account first';

    case 11:
      return evidence.onboarding?.backgroundCheckConsentAt
        ? null
        : 'Give your consent to the background verification check first';

    default: {
      const document = STEP_DOCUMENT[step];
      if (!document) {
        return null;
      }
      return evidence.documents.some(
        (doc) => doc.documentType === document.type,
      )
        ? null
        : `Upload your ${document.label} first`;
    }
  }
}
