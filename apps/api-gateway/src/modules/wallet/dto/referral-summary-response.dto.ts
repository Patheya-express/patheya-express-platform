import { ApiProperty } from '@nestjs/swagger';

export class ReferralSummaryResponseDto {
  @ApiProperty({ example: 'A1B2C3D4' })
  referralCode: string;

  @ApiProperty({
    description: 'Number of people who signed up with this code.',
  })
  totalReferred: number;

  @ApiProperty({
    description:
      'Number of those referrals that have been rewarded (referee completed their first order).',
  })
  totalRewarded: number;

  @ApiProperty({
    description:
      'Total amount earned from referral rewards, credited to wallet.',
  })
  totalEarned: number;
}
