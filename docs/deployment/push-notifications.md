# Push notifications — setup runbook

Delivery-partner apps get new-assignment offers two ways:

| App state | Transport | Needs credentials? |
|---|---|---|
| Open (foreground) | Socket.IO `delivery.assignment` event → in-app alert | No — works today |
| Backgrounded / closed | Push: FCM (Android), APNs (iOS) | **Yes — this runbook** |

Until the credentials below exist, every push attempt is recorded on its `notifications` row as
`FAILED` with `Push provider not configured`. Nothing is ever marked `SENT` unless FCM/APNs
accepted it.

## How it works (code, already in place)

1. `DispatchService.assignOrder` / `AdminDispatchService` commit the assignment, then publish
   `delivery.assignment.offered`.
2. `DeliveryAssignmentPushListener` creates one `PUSH` notification per assignment (deduplicated
   by assignment id) and queues `send-push` on the `notifications` BullMQ queue (jobId =
   assignment, retried with exponential backoff).
3. `NotificationProcessor` (worker) → `NotificationsService.deliverPushNotification` →
   `PlatformPushDispatcher`: `android` tokens → `FcmPushProvider` (HTTP v1), `ios` tokens →
   `ApnsPushProvider` (HTTP/2, token auth). The iOS app registers raw APNs tokens (no Firebase
   iOS SDK), which FCM cannot deliver to — that is why iOS goes to APNs directly.
4. Invalid tokens are deleted; outcomes are logged (`push_delivery_attempt`, never tokens) and
   counted (`patheya_push_delivery_total{platform,outcome}`).
5. Payload = ids only (`type`, `assignmentId`, `orderId`). A tap opens `/assignments` through
   login/session restore; the app re-fetches the assignment, so an expired/reassigned offer is
   never actionable. Accept/reject are authenticated backend calls.

## 1. Firebase (Android)

1. Firebase console → create (or pick) the Patheya project.
2. **Add Android app** with package name **`com.patheyaexpress.delivery`** (must match
   `apps/delivery-app/capacitor.config.ts` `appId`).
3. Download **`google-services.json`** → place at
   `frontend/apps/delivery-app/android/app/google-services.json`.
   The Gradle build applies the Google Services plugin automatically when that file exists
   (`android/app/build.gradle`). Treat it as config, not a secret, but keep it out of public repos.
4. Project settings → **Service accounts** → *Generate new private key* (JSON). From it:
   - `project_id` → `FCM_PROJECT_ID`
   - `client_email` → `FCM_CLIENT_EMAIL`
   - `private_key` → `FCM_PRIVATE_KEY` (keep the `\n` escapes; the app restores newlines)
   The service account needs the *Firebase Cloud Messaging API (V1)* enabled (default for new
   projects).

## 2. Apple (iOS)

1. Apple Developer → *Identifiers* → App ID **`com.patheyaexpress.delivery`** → enable
   **Push Notifications**.
2. Apple Developer → *Keys* → create a key with **Apple Push Notifications service (APNs)** →
   download the `.p8` (only downloadable once). Note its **Key ID** and your **Team ID**.
   - Key ID → `APNS_KEY_ID`, Team ID → `APNS_TEAM_ID`
   - `.p8` contents → `APNS_PRIVATE_KEY` (escape newlines as `\n`)
   - `APNS_BUNDLE_ID=com.patheyaexpress.delivery`
   - `APNS_ENVIRONMENT=production` for TestFlight/App Store builds; `development` only for
     builds run directly from Xcode.
3. Xcode: the project already has `App/App.entitlements` (`aps-environment`) referenced via
   `CODE_SIGN_ENTITLEMENTS`, and `AppDelegate.swift` forwards the APNs token to Capacitor. Select
   your team in *Signing & Capabilities* (left unset in the repo on purpose); Xcode will attach the
   Push Notifications capability to the provisioning profile.

## 3. API and worker environment

Both the **API** and the **worker** need the variables (the worker sends; the API only needs them
for admin "retry"). In AWS they come from Secrets Manager through the ECS module's `app_secrets`
map (`patheya-express-terraform/modules/ecs`), which feeds both task definitions:

```
FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY
APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRIVATE_KEY, APNS_ENVIRONMENT
```

Adding them is an infrastructure change (new secret keys + `app_secrets` entries) and goes
through the normal Terraform review/approval flow. Locally, put them in `apps/api-gateway/.env`
(git-ignored). Never commit real values.

## 4. Verify (physical devices required)

Emulators/simulators are not sufficient for APNs; use real devices.

1. Install the app on a device, log in as an approved partner, allow notifications.
   Confirm a `push_tokens` row exists for the partner with `platform` = `android`/`ios`.
2. Go online, put the app in the **background**, create an order and let dispatch offer it →
   expect a "New delivery assigned" notification; the `notifications` row becomes `SENT`.
3. Repeat with the app **force-closed**.
4. Tap the notification → app opens (login if needed) → Assignments shows the offer → accept.
5. Let an offer expire, then tap its notification → the offer is not actionable.
6. With the app **open**, a new offer shows one in-app alert (no duplicate banner).
7. Log out → the partner's `push_tokens` row for that device is removed.
