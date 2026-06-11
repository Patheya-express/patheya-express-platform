import { Injectable } from '@angular/core';

import { Observable, tap } from 'rxjs';

import {
  AuthService as GeneratedAuthService,
  LoginDto,
  RefreshResponseDto,
  RefreshTokenDto,
  RegisterDto,
  RegisterResponseDto,
} from '@patheya/api-sdk';

import { SessionService } from './session.service';
import { TokenStorageService } from './token-storage.service';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  constructor(
    private readonly authApi: GeneratedAuthService,

    private readonly tokenStorage: TokenStorageService,

    private readonly sessionService: SessionService,
  ) {}

  login(
    payload: LoginDto,
  ): Observable<RegisterResponseDto> {
    return this.authApi
      .authControllerLogin(payload)
      .pipe(
        tap((response) => {
          this.persistSession(
            response,
          );
        }),
      );
  }

  register(
    payload: RegisterDto,
  ): Observable<RegisterResponseDto> {
    return this.authApi
      .authControllerRegister(
        payload,
      )
      .pipe(
        tap((response) => {
          this.persistSession(
            response,
          );
        }),
      );
  }

  refreshToken():
    | Observable<RefreshResponseDto>
    | never {
    const refreshToken =
      this.tokenStorage.getRefreshToken();

    if (!refreshToken) {
      throw new Error(
        'Refresh token not found',
      );
    }

    const payload: RefreshTokenDto =
      {
        refreshToken,
      };

    return this.authApi
      .authControllerRefreshToken(
        payload,
      )
      .pipe(
        tap((response) => {
          this.tokenStorage.setAccessToken(
            response.accessToken,
          );
        }),
      );
  }

  logout(): Observable<any> {
    const refreshToken =
      this.tokenStorage.getRefreshToken();

    const payload: RefreshTokenDto =
      {
        refreshToken:
          refreshToken ?? '',
      };

    return this.authApi
      .authControllerLogout(
        payload,
      )
      .pipe(
        tap(() => {
          this.clearSession();
        }),
      );
  }

  restoreSession(): boolean {
    const accessToken =
      this.tokenStorage.getAccessToken();

    const refreshToken =
      this.tokenStorage.getRefreshToken();

    const user =
      this.tokenStorage.getUser();

    if (
      !accessToken ||
      !refreshToken ||
      !user
    ) {
      return false;
    }

    this.sessionService.setSession(
      {
        accessToken,
        refreshToken,
        user,
      },
    );

    return true;
  }

  private persistSession(
    response: RegisterResponseDto,
  ): void {
    this.tokenStorage.setAccessToken(
      response.accessToken,
    );

    this.tokenStorage.setRefreshToken(
      response.refreshToken,
    );

    this.tokenStorage.setUser(
      response.user,
    );

    this.sessionService.setSession(
      {
        user: response.user,
        accessToken:
          response.accessToken,
        refreshToken:
          response.refreshToken,
      },
    );
  }

  private clearSession(): void {
    this.tokenStorage.clear();

    this.sessionService.clear();
  }
}