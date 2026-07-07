import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class DevAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    request.user = {
      userId: 'YOUR_TEST_USER_ID',

      role: 'ADMIN',

      email: 'dev@patheya.com',
    };

    return true;
  }
}
