import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  USER_KEY,
} from '../tokens/auth.tokens';

export class TokenStorageService {
  getAccessToken(): string | null {
    return localStorage.getItem(
      ACCESS_TOKEN_KEY,
    );
  }

  setAccessToken(
    token: string,
  ): void {
    localStorage.setItem(
      ACCESS_TOKEN_KEY,
      token,
    );
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(
      REFRESH_TOKEN_KEY,
    );
  }

  setRefreshToken(
    token: string,
  ): void {
    localStorage.setItem(
      REFRESH_TOKEN_KEY,
      token,
    );
  }

  getUser<T>(): T | null {
    const value =
      localStorage.getItem(USER_KEY);

    if (!value) {
      return null;
    }

    return JSON.parse(value);
  }

  setUser(user: unknown): void {
    localStorage.setItem(
      USER_KEY,
      JSON.stringify(user),
    );
  }

  clear(): void {
    localStorage.removeItem(
      ACCESS_TOKEN_KEY,
    );

    localStorage.removeItem(
      REFRESH_TOKEN_KEY,
    );

    localStorage.removeItem(
      USER_KEY,
    );
  }
}