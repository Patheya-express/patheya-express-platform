import { OmitType, PartialType } from '@nestjs/swagger';

import { CreateOfferDto } from './create-offer.dto';

/** Everything from CreateOfferDto except `restaurantId` — an offer's owning restaurant is fixed
 *  at creation and isn't reassignable via update. */
export class UpdateOfferDto extends PartialType(
  OmitType(CreateOfferDto, ['restaurantId'] as const),
) {}
