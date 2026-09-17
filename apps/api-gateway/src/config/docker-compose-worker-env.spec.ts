import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression coverage for "rider1 never receives pickup assignments": the `worker` service in
 * infrastructure/docker/docker-compose.yml (the opt-in `--profile worker` container that runs
 * worker-main.ts / WorkerModule — the only process that consumes the `dispatch` BullMQ queue;
 * AppModule/api-gateway only ever produces jobs onto it, never consumes) was missing the
 * RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET/RAZORPAY_WEBHOOK_SECRET env vars that the `api-gateway`
 * service already carries as dev-mode placeholders. RazorpayProvider
 * (src/modules/payments/providers/razorpay.provider.ts) constructs the Razorpay SDK client
 * unconditionally in its constructor, and the worker pulls it in transitively via
 * PaymentsWorkerModule — so without these vars the worker container crash-looped on every boot
 * and never ran AssignmentExpiryProcessor, leaving every `dispatch-assignment` job (and therefore
 * every delivery-partner assignment) stuck in the queue forever, with no error visible anywhere
 * in the HTTP API or the delivery app. Confirmed live: the stuck job only started processing, and
 * rider1 only received a real assignment through GET /dispatch/assignments, once the worker
 * container was rebuilt with these vars present.
 *
 * A plain text/regex check on the compose file, not a live `docker compose config` invocation or
 * a new YAML-parsing dependency — deterministic, no Docker daemon needed to run this suite, and
 * this repo has no YAML parser dependency to add one just for this.
 */
describe('infrastructure/docker/docker-compose.yml worker service env', () => {
  const composePath = join(
    __dirname,
    '../../../../infrastructure/docker/docker-compose.yml',
  );
  // Normalize CRLF -> LF: this file is checked in with Windows line endings.
  const compose = readFileSync(composePath, 'utf8').replace(/\r\n/g, '\n');

  function serviceBlock(serviceName: string): string {
    // Every top-level service block starts at a "  <name>:" line (2-space indent); its content is
    // indented further (4+ spaces) until the next line indented at 2 spaces or less (the next
    // service, or the trailing top-level "volumes:" block) starts.
    const startMarker = `\n  ${serviceName}:\n`;
    const startIndex = compose.indexOf(startMarker);

    if (startIndex === -1) {
      throw new Error(
        `Could not find a "${serviceName}:" service block in docker-compose.yml — has the file been restructured?`,
      );
    }

    const bodyStart = startIndex + startMarker.length;
    const nextBoundary = compose.slice(bodyStart).search(/\n {0,2}\S/);
    const bodyEnd =
      nextBoundary === -1 ? compose.length : bodyStart + nextBoundary;

    return compose.slice(bodyStart, bodyEnd);
  }

  const REQUIRED_RAZORPAY_KEYS = [
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
  ];

  it("api-gateway's service block defines all three Razorpay dev placeholders (sanity check on the test's own parsing, and the pre-existing baseline this regression compares the worker service against)", () => {
    const apiGatewayBlock = serviceBlock('api-gateway');

    for (const key of REQUIRED_RAZORPAY_KEYS) {
      expect(apiGatewayBlock).toContain(`${key}:`);
    }
  });

  it('the worker service block defines the same three Razorpay env vars as api-gateway — omitting them crash-loops the only process that consumes the dispatch queue', () => {
    const workerBlock = serviceBlock('worker');

    for (const key of REQUIRED_RAZORPAY_KEYS) {
      expect(workerBlock).toContain(`${key}:`);
    }
  });
});
