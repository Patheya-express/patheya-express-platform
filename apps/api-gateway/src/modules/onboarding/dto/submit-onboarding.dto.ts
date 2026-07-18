import { ApiProperty } from '@nestjs/swagger';

import { Equals } from 'class-validator';

export class SubmitOnboardingDto {
  @ApiProperty({
    example: true,
    description:
      'Must be true — the wizard cannot be submitted without accepting terms.',
  })
  @Equals(true, {
    message: 'acceptedTerms must be true to submit the application',
  })
  acceptedTerms: boolean;
}
