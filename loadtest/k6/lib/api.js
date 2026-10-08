// Thin HTTP layer over the real api-gateway routes. Every request is tagged with its route
// template (`name`) so IDs in the URL don't explode metric cardinality, and every response is
// checked against the `{ success, timestamp, data }` envelope from ResponseInterceptor.
//
// Never logs request headers or bodies — the Authorization header carries a live JWT.

import http from 'k6/http';
import { check } from 'k6';
import { b64decode } from 'k6/encoding';
import { Rate } from 'k6/metrics';
import { API, BASE_URL } from './config.js';

export const throttled = new Rate('throttled');

function query(qs) {
  const parts = Object.keys(qs || {})
    .filter((k) => qs[k] !== undefined && qs[k] !== null && qs[k] !== '')
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(qs[k])}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

// GET {API}{path}?qs — `name` is the route template, e.g. 'GET /restaurants/:id'.
// Returns the envelope's `data`, or null on any non-200 / malformed response.
export function get(name, path, qs, token) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = http.get(`${API}${path}${query(qs)}`, { headers, tags: { name }, timeout: '30s' });
  throttled.add(res.status === 429);

  let body = null;
  if (res.status === 200) {
    try {
      body = res.json();
    } catch (_) {
      body = null;
    }
  }
  check(res, {
    'status is 200': (r) => r.status === 200,
    'envelope success': () => body !== null && body.success === true,
  });
  return body ? body.data : null;
}

// Readiness verifies DB, Redis and BullMQ — checked once in setup() as a last sanity gate.
export function isReady() {
  const res = http.get(`${BASE_URL}/api/v1/health/ready`, {
    tags: { name: 'GET /health/ready' },
    timeout: '10s',
  });
  return res.status === 200;
}

// POST /auth/login exactly once per run (setup()). Login writes a refresh-token row and is
// throttled at 5/min/IP, so it must never run per-VU or per-iteration. Refuses any account that
// is not a CUSTOMER — an admin/owner token must never be shared across 1000 VUs.
export function login(email, password) {
  const res = http.post(`${API}/auth/login`, JSON.stringify({ email, password }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'POST /auth/login' },
  });
  if (res.status !== 200 && res.status !== 201) {
    // Status only — never the body (it may echo the email) and never the password.
    throw new Error(`Load-test login failed with HTTP ${res.status}`);
  }
  const data = res.json('data');
  if (!data || !data.accessToken) throw new Error('Login response had no accessToken');
  if (!data.user || data.user.role !== 'CUSTOMER') {
    throw new Error('Load-test account must have role CUSTOMER — refusing to use it');
  }
  return data.accessToken;
}

// Reads `exp` from the JWT payload so VUs stop using it before it expires (15 min TTL).
// The claim is decoded locally; the token itself is never printed.
export function jwtExpiryEpochMs(token) {
  const payload = token.split('.')[1];
  return JSON.parse(b64decode(payload, 'rawurl', 's')).exp * 1000;
}
