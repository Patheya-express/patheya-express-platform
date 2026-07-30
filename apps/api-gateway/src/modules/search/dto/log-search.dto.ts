import { IsString, MinLength } from 'class-validator';

export class LogSearchDto {
  @IsString()
  @MinLength(1)
  query: string;
}
