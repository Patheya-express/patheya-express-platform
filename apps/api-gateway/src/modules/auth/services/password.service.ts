import { Injectable } from '@nestjs/common';

import * as bcrypt from 'bcrypt';

import { AUTH_CONSTANTS } from '../constants/auth.constant';

@Injectable()
export class PasswordService {
  async hashPassword(password: string) {
    return bcrypt.hash(
      password,

      AUTH_CONSTANTS.BCRYPT_SALT_ROUNDS,
    );
  }

  async comparePassword(
    password: string,

    hash: string,
  ) {
    return bcrypt.compare(password, hash);
  }
}
