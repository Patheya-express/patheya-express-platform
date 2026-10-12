import { BadRequestException } from '@nestjs/common';
import {
  DeliveryDocumentType,
  DeliveryOnboardingStatus,
  Gender,
} from '@prisma/client';

import { OnboardingService } from './onboarding.service';
import {
  VERIFIABLE_ONBOARDING_STEPS,
  missingOnboardingStepRequirement,
  type OnboardingStepEvidence,
} from './onboarding-step-requirements';
import type { DeliveryRepository } from '../repositories/delivery.repository';
import type { OnboardingRepository } from '../repositories/onboarding.repository';
import type { AuditService } from '../../audit/services/audit.service';
import type { RealtimeService } from '../../realtime/services/realtime.service';
import type { NotificationsService } from '../../notifications/services/notifications.service';
import type { VerificationService } from './verification.service';

/**
 * 2026-10-12 — the backend used to mark any onboarding wizard step complete on request. These
 * cover the server-side evidence check now applied in completeStep and re-applied at submit.
 */
function completeEvidence(
  overrides: Partial<OnboardingStepEvidence> = {},
): OnboardingStepEvidence {
  return {
    dateOfBirth: new Date('1995-04-01'),
    gender: Gender.MALE,
    languagesSpoken: ['English', 'Telugu'],
    currentAddressLine1: '373 Road Number 10',
    currentCity: 'Hyderabad',
    currentState: 'Telangana',
    currentPostalCode: '500073',
    currentAddressLatitude: 17.43,
    currentAddressLongitude: 78.41,
    vehicles: [{ id: 'vehicle-1' }],
    documents: [
      DeliveryDocumentType.DRIVING_LICENSE,
      DeliveryDocumentType.AADHAAR,
      DeliveryDocumentType.PAN,
      DeliveryDocumentType.VEHICLE_RC,
      DeliveryDocumentType.VEHICLE_INSURANCE,
      DeliveryDocumentType.SELFIE,
    ].map((documentType) => ({ documentType })),
    bankAccount: { deliveryPartnerId: 'partner-1' },
    onboarding: { backgroundCheckConsentAt: new Date('2026-10-01') },
    ...overrides,
  };
}

describe('missingOnboardingStepRequirement', () => {
  it('accepts every verifiable step when the data exists', () => {
    for (const step of VERIFIABLE_ONBOARDING_STEPS) {
      expect(
        missingOnboardingStepRequirement(step, completeEvidence()),
      ).toBeNull();
    }
  });

  it('step 1 needs date of birth, gender and a non-blank language', () => {
    expect(
      missingOnboardingStepRequirement(1, completeEvidence({ gender: null })),
    ).toMatch(/date of birth and gender/);
    expect(
      missingOnboardingStepRequirement(
        1,
        completeEvidence({ languagesSpoken: ['  '] }),
      ),
    ).toMatch(/language/);
  });

  it('step 2 needs the address fields and a picked (non-0/0) location', () => {
    expect(
      missingOnboardingStepRequirement(
        2,
        completeEvidence({ currentPostalCode: ' ' }),
      ),
    ).toMatch(/current address/);
    expect(
      missingOnboardingStepRequirement(
        2,
        completeEvidence({
          currentAddressLatitude: 0,
          currentAddressLongitude: 0,
        }),
      ),
    ).toMatch(/on the map/);
  });

  it('step 3 needs an active vehicle and step 9 a bank account', () => {
    expect(
      missingOnboardingStepRequirement(3, completeEvidence({ vehicles: [] })),
    ).toMatch(/vehicle/);
    expect(
      missingOnboardingStepRequirement(
        9,
        completeEvidence({ bankAccount: null }),
      ),
    ).toMatch(/bank account/);
  });

  it.each([
    [4, DeliveryDocumentType.DRIVING_LICENSE, /driving licence/],
    [5, DeliveryDocumentType.AADHAAR, /Aadhaar/],
    [6, DeliveryDocumentType.PAN, /PAN/],
    [7, DeliveryDocumentType.VEHICLE_RC, /RC/],
    [8, DeliveryDocumentType.VEHICLE_INSURANCE, /insurance/],
    [10, DeliveryDocumentType.SELFIE, /selfie/],
  ])('step %i needs its %s upload', (step, type, message) => {
    const evidence = completeEvidence();
    evidence.documents = evidence.documents.filter(
      (doc) => doc.documentType !== type,
    );

    expect(missingOnboardingStepRequirement(step, evidence)).toMatch(message);
  });

  it('step 11 needs recorded background-check consent, but not the optional police clearance', () => {
    expect(VERIFIABLE_ONBOARDING_STEPS).toContain(11);
    expect(
      missingOnboardingStepRequirement(
        11,
        completeEvidence({ onboarding: { backgroundCheckConsentAt: null } }),
      ),
    ).toMatch(/consent/);
    expect(
      missingOnboardingStepRequirement(11, completeEvidence({ documents: [] })),
    ).toBeNull();
  });
});

describe('OnboardingService — step completion and submission', () => {
  let deliveryRepository: { findPartnerByUserId: jest.Mock };
  let onboardingRepository: {
    findOrCreate: jest.Mock;
    findStepEvidence: jest.Mock;
    markStepComplete: jest.Mock;
    setStatus: jest.Mock;
    recordBackgroundCheckConsent: jest.Mock;
  };
  let verificationService: { submit: jest.Mock };
  let service: OnboardingService;

  const ONBOARDING = {
    id: 'onboarding-1',
    deliveryPartnerId: 'partner-1',
    status: DeliveryOnboardingStatus.IN_PROGRESS,
    currentStep: 12,
    completedSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    termsAcceptedAt: null,
    submittedAt: null,
    decidedAt: null,
    changesRequested: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    deliveryRepository = {
      findPartnerByUserId: jest.fn().mockResolvedValue({ id: 'partner-1' }),
    };
    onboardingRepository = {
      findOrCreate: jest.fn().mockResolvedValue(ONBOARDING),
      findStepEvidence: jest.fn().mockResolvedValue(completeEvidence()),
      markStepComplete: jest.fn().mockResolvedValue(ONBOARDING),
      recordBackgroundCheckConsent: jest.fn().mockResolvedValue({
        ...ONBOARDING,
        backgroundCheckConsentAt: new Date('2026-10-12T10:00:00Z'),
      }),
      setStatus: jest.fn().mockResolvedValue({
        ...ONBOARDING,
        status: DeliveryOnboardingStatus.UNDER_REVIEW,
      }),
    };
    verificationService = { submit: jest.fn().mockResolvedValue(undefined) };

    service = new OnboardingService(
      deliveryRepository as unknown as DeliveryRepository,
      onboardingRepository as unknown as OnboardingRepository,
      {
        log: jest.fn().mockResolvedValue(undefined),
      } as unknown as AuditService,
      { emitToUser: jest.fn() } as unknown as RealtimeService,
      {
        createNotification: jest.fn().mockResolvedValue(null),
      } as unknown as NotificationsService,
      verificationService as unknown as VerificationService,
    );
  });

  it('marks a step complete once its data exists', async () => {
    await service.completeStep('user-1', 4);

    expect(onboardingRepository.markStepComplete).toHaveBeenCalledWith(
      'partner-1',
      4,
    );
  });

  it('refuses to mark a step complete without its data', async () => {
    onboardingRepository.findStepEvidence.mockResolvedValue(
      completeEvidence({ documents: [] }),
    );

    await expect(service.completeStep('user-1', 4)).rejects.toThrow(
      /Step 4 is not complete: Upload your driving licence first/,
    );
    expect(onboardingRepository.markStepComplete).not.toHaveBeenCalled();
  });

  it('refuses a submission whose completed steps are no longer backed by data', async () => {
    onboardingRepository.findStepEvidence.mockResolvedValue(
      completeEvidence({ bankAccount: null, vehicles: [] }),
    );

    await expect(
      service.submit('user-1', { acceptedTerms: true }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.submit('user-1', { acceptedTerms: true }),
    ).rejects.toThrow(/Steps 3, 9 are missing required details/);
    expect(verificationService.submit).not.toHaveBeenCalled();
    expect(onboardingRepository.setStatus).not.toHaveBeenCalled();
  });

  it('submits a complete, evidenced application', async () => {
    await service.submit('user-1', { acceptedTerms: true });

    expect(verificationService.submit).toHaveBeenCalledWith('user-1');
    expect(onboardingRepository.setStatus).toHaveBeenCalledWith(
      'partner-1',
      DeliveryOnboardingStatus.UNDER_REVIEW,
      expect.anything(),
    );
  });
  it('records background-check consent and returns it', async () => {
    const result = await service.recordBackgroundCheckConsent('user-1', true);

    expect(
      onboardingRepository.recordBackgroundCheckConsent,
    ).toHaveBeenCalledWith('partner-1');
    expect(result.backgroundCheckConsentAt).toEqual(
      new Date('2026-10-12T10:00:00Z'),
    );
  });

  it('refuses to complete step 11 before consent is recorded', async () => {
    onboardingRepository.findStepEvidence.mockResolvedValue(
      completeEvidence({ onboarding: { backgroundCheckConsentAt: null } }),
    );

    await expect(service.completeStep('user-1', 11)).rejects.toThrow(
      /Step 11 is not complete/,
    );
    expect(onboardingRepository.markStepComplete).not.toHaveBeenCalled();
  });
});
