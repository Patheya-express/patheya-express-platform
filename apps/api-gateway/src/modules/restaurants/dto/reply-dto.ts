import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

const MAX_REPLY_LENGTH = 1000;

/** Shared by both create and update — a reply's shape never differs between the two operations. */
export class ReplyDto {
  @ApiProperty({
    example: 'Thank you for your feedback! We are glad you enjoyed your meal.',
    maxLength: MAX_REPLY_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REPLY_LENGTH)
  replyText: string;
}
