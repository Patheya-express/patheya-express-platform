import { Injectable } from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';

import { AUTH_CONSTANTS } from '../constants/auth.constant';

@Injectable()
export class TokenService {
  constructor(private readonly jwtService: JwtService) {}

  async generateAccessToken(payload: Record<string, any>) {
    return this.jwtService.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET as string,

      expiresIn: AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRES,
    });
  }

  async generateRefreshToken(payload: Record<string, any>) {
    return this.jwtService.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET as string,

      expiresIn: AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRES,
    });
  }

  /** Verifies the refresh JWT's own signature and `exp` claim — throws (JsonWebTokenError /
   *  TokenExpiredError) if either is invalid. This is the check the refresh flow was previously
   *  skipping entirely, relying only on the DB row's existence. */
  async verifyRefreshToken(token: string): Promise<Record<string, any>> {
    return this.jwtService.verifyAsync(token, {
      secret: process.env.JWT_REFRESH_SECRET as string,
    });
  }
}
