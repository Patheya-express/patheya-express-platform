import { Injectable } from '@angular/core';

import { AuthSession } from '../models/auth-session.model';

@Injectable({
  providedIn: 'root',
})
export class SessionService {
  private session: AuthSession | null =
    null;

  setSession(
    session: AuthSession,
  ): void {
    this.session = session;
  }

  getSession():
    | AuthSession
    | null {
    return this.session;
  }

  getAccessToken():
    | string
    | null {
    return this.session?.accessToken ?? null;
  }

  clear(): void {
    this.session = null;
  }
}