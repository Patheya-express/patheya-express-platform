import {
  AuthUserDto,
} from '@patheya/api-sdk';

export interface AuthSession {
  user: AuthUserDto;

  accessToken: string;

  refreshToken: string;
}