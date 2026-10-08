// Load-test configuration: profiles, hard safety limits and abort thresholds.
//
// Every number here is a ceiling the run cannot exceed — env vars may LOWER a limit, never raise
// it past the HARD_* constants. Changing a HARD_* constant is a reviewed code change, not a flag.

export const HARD_MAX_VUS = 1000;
export const HARD_MAX_DURATION_SECONDS = 60 * 60;
export const HARD_MAX_RPS = 1000;

const PRODUCTION_HOSTS = ['api.patheyaexpress.com'];
const LOCAL_HOSTS = ['localhost', '127.0.0.1', 'host.docker.internal'];
const PREFLIGHT_MAX_AGE_SECONDS = 15 * 60;

function intEnv(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (got "${raw}")`);
  }
  return value;
}

export const BASE_URL = (__ENV.BASE_URL || '').replace(/\/+$/, '');
export const API = `${BASE_URL}/api/v1`;
export const PROFILE = __ENV.PROFILE || 'smoke';
export const MAX_VUS = Math.min(intEnv('MAX_VUS', HARD_MAX_VUS), HARD_MAX_VUS);
export const MAX_RPS = Math.min(intEnv('MAX_RPS', 800), HARD_MAX_RPS);
export const ALLOW_EMPTY_CATALOG = __ENV.ALLOW_EMPTY_CATALOG === 'true';

// Each stage is held long enough to read a steady state: a short ramp to the target, then a hold.
// The `name` becomes the `stage` tag on every request, so per-level p50/p95/p99 and per-level
// abort thresholds come straight out of the k6 summary.
function step(target, holdSeconds, rampSeconds = 30) {
  return { name: `vu${target}`, target, rampSeconds, holdSeconds };
}

const PROFILES = {
  // Script/route validation only — 2 VUs, run first after every deploy or infra change.
  smoke: () => [step(2, 60, 10)],

  // Steady low load for a reference latency at a known-good level.
  baseline: () => [step(25, 600, 60)],

  // The capacity search. 7 levels x 5 min = 35 min. Stops early via thresholds (see buildThresholds).
  ramp: () =>
    [25, 50, 100, 250, 500, 750, 1000]
      .filter((target) => target <= MAX_VUS)
      .map((target) => step(target, 270, 30)),

  // Hold at a level ABOVE the measured sustainable point to see how the system degrades and
  // whether it recovers. STRESS_VUS must be set from ramp results — no default on purpose.
  stress: () => {
    const vus = intEnv('STRESS_VUS', 0);
    if (!vus) throw new Error('PROFILE=stress requires STRESS_VUS (set from the ramp result)');
    return [step(vus, 600, 300)];
  },

  // Sudden jump from a quiet baseline, then a recovery window back at baseline.
  spike: () => {
    const vus = intEnv('SPIKE_VUS', 500);
    return [step(25, 120, 30), step(vus, 180, 30), { ...step(25, 300, 30), name: 'recovery' }];
  },

  // Long hold at ~70% of the measured sustainable VUs: leaks, pool exhaustion, queue growth.
  soak: () => {
    const vus = intEnv('SOAK_VUS', 0);
    if (!vus) throw new Error('PROFILE=soak requires SOAK_VUS (~70% of measured sustainable VUs)');
    return [step(vus, 45 * 60, 120)];
  },
};

export const RAMP_DOWN_SECONDS = 60;

export function buildStages() {
  const factory = PROFILES[PROFILE];
  if (!factory) {
    throw new Error(`Unknown PROFILE "${PROFILE}". One of: ${Object.keys(PROFILES).join(', ')}`);
  }
  const stages = factory();

  for (const stage of stages) {
    if (stage.target > MAX_VUS) {
      throw new Error(`Stage ${stage.name} targets ${stage.target} VUs > MAX_VUS ${MAX_VUS}`);
    }
  }
  const total =
    stages.reduce((sum, s) => sum + s.rampSeconds + s.holdSeconds, 0) + RAMP_DOWN_SECONDS;
  if (total > HARD_MAX_DURATION_SECONDS) {
    throw new Error(`Profile ${PROFILE} runs ${total}s > hard limit ${HARD_MAX_DURATION_SECONDS}s`);
  }
  return stages;
}

// k6 `stages` for the ramping-vus executor. Each logical stage = ramp + hold.
export function toK6Stages(stages) {
  const out = [];
  for (const s of stages) {
    out.push({ duration: `${s.rampSeconds}s`, target: s.target });
    out.push({ duration: `${s.holdSeconds}s`, target: s.target });
  }
  out.push({ duration: `${RAMP_DOWN_SECONDS}s`, target: 0 });
  return out;
}

// Maps seconds-since-scenario-start to the logical stage name (used to tag requests).
export function stageAt(stages, elapsedSeconds) {
  let boundary = 0;
  for (const s of stages) {
    boundary += s.rampSeconds + s.holdSeconds;
    if (elapsedSeconds < boundary) return s.name;
  }
  return 'rampdown';
}

// Client-side abort conditions. k6 thresholds are cumulative over the samples they match, so the
// latency/error limits are applied per stage (tag `stage`) — a cumulative p95 would be diluted
// by the fast early stages and react far too late. delayAbortEval gives each stage's ramp time
// to settle so one cold-start burst cannot end the run; after that a breach aborts immediately.
// Server-side abort conditions (DB/Redis/ECS/ALB) live in scripts/watchdog.sh.
export function buildThresholds(stages) {
  const thresholds = {
    // Global: >2% failed requests at any point after the first minute ends the run.
    http_req_failed: [{ threshold: 'rate<0.02', abortOnFail: true, delayAbortEval: '1m' }],
    // Any meaningful 429 volume means we are measuring the app rate limiter, not capacity.
    throttled: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '30s' }],
    // Envelope/shape checks.
    checks: [{ threshold: 'rate>0.98', abortOnFail: true, delayAbortEval: '1m' }],
  };
  for (const s of stages) {
    thresholds[`http_req_duration{stage:${s.name}}`] = [
      { threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '2m' },
      { threshold: 'p(99)<5000', abortOnFail: true, delayAbortEval: '2m' },
    ];
    thresholds[`http_req_failed{stage:${s.name}}`] = [
      { threshold: 'rate<0.02', abortOnFail: true, delayAbortEval: '1m' },
    ];
    // Registers the per-stage request counter so its rate shows in the summary.
    thresholds[`http_reqs{stage:${s.name}}`] = ['count>=0'];
  }
  return thresholds;
}

// Refuses to target production unless scripts/preflight.sh passed within the last 15 minutes and
// the operator confirmed explicitly. Runs at init time, before any VU sends a request.
// `readStamp` is passed in from main.js because open() must resolve relative to the entry script.
export function assertTargetAllowed(readStamp) {
  const match = BASE_URL.match(/^(https?):\/\/([^/:]+)/);
  if (!match) {
    throw new Error('BASE_URL must be set to an http(s) origin (e.g. https://api.patheyaexpress.com)');
  }
  const [, scheme, host] = match;
  // Plain http only for a local API (validating the suite on a laptop); everything else is https.
  if (scheme !== 'https' && !LOCAL_HOSTS.includes(host)) {
    throw new Error('BASE_URL must use https:// for any non-local target');
  }
  if (!PRODUCTION_HOSTS.includes(host)) return;

  if (__ENV.CONFIRM_PRODUCTION !== 'I_UNDERSTAND') {
    throw new Error('Targeting production requires CONFIRM_PRODUCTION=I_UNDERSTAND');
  }
  let stamp;
  try {
    stamp = JSON.parse(readStamp());
  } catch (_) {
    throw new Error('No results/preflight.json — run scripts/preflight.sh first (it must pass)');
  }
  const ageSeconds = (Date.now() - stamp.checkedAtEpochMs) / 1000;
  if (!stamp.ok || stamp.baseUrl !== BASE_URL || ageSeconds > PREFLIGHT_MAX_AGE_SECONDS) {
    throw new Error(
      `Preflight stamp is not valid for this run (ok=${stamp.ok}, baseUrl=${stamp.baseUrl}, ` +
        `age=${Math.round(ageSeconds)}s, max=${PREFLIGHT_MAX_AGE_SECONDS}s) — re-run scripts/preflight.sh`,
    );
  }
}
