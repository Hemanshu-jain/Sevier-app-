# Mobile Agent PWA and Android Preparation Design

**Date:** 2026-09-01

**Status:** Approved for implementation planning

## Purpose

Complete the field-agent side of Handoff as an installable Android-oriented PWA and prepare the same production build for a Capacitor Android wrapper. Finance users continue using the desktop interface. Independent seizure agents continue using the role-gated mobile interface and can access only work orders assigned to them.

The mobile product must preserve field work through connectivity loss, prevent duplicate submissions, and keep the finance and agent experiences interlinked through the existing Express API and tenant database.

## Product boundaries

- Finance-company super-admins, managers, and staff remain in the desktop interface.
- Independent agents receive only directly assigned work orders.
- Borrowers and parking yards do not receive application accounts.
- English is the only interface language in this version.
- Assignment acceptance, yard logins, customer logins, payment collection, push-notification providers, and public release-pass verification are outside this phase.
- In-app notifications are included. Push notifications remain a later server-deployment feature.
- This phase creates and verifies an Android-ready Capacitor project. A compiled APK is not an acceptance requirement because the current machine has no Android SDK, ADB, or Gradle installation.

## Architecture

One React/Vite application remains the source of truth. `Root` routes finance roles to the desktop interface and the `agent` role to the mobile interface. Both clients use the same Express API, OTP sessions, permission contract, tenant scope, and database.

The mobile interface is completed in focused units rather than creating another frontend:

- `FieldApp` owns authenticated agent navigation and server refresh.
- Agent home presents assigned and submitted work plus sync status.
- Work-order screens handle verification, evidence, custody, and failed attempts.
- A notification view presents agent-addressed notifications.
- A sync view presents pending, uploading, and needs-attention operations.
- A small IndexedDB module persists cached assignments, drafts, evidence blobs, and queued mutations.
- A queue runner submits operations in dependency order whenever the app is open and online.

No API response or evidence file is added to the service-worker cache. The service worker remains responsible only for the public application shell and static assets.

## Offline data model

Use the browser's native IndexedDB API without adding an offline-state dependency. The database name is `handoff-field-v1` and contains four stores:

1. `workspaces`
   - Key: agent user ID.
   - Value: the last successfully fetched assigned cases, agent-addressed notifications, and cache timestamp.

2. `drafts`
   - Key: `[userId, caseId]`.
   - Value: registration, chassis suffix, verification state, captured GPS, inspection values, parking location, arrival time, rate, custom note, handover confirmation, and updated timestamp.

3. `evidenceBlobs`
   - Key: generated blob ID.
   - Value: agent ID, case ID, original file name, MIME type, size, capture timestamp, optional GPS, and binary `Blob`.

4. `mutations`
   - Key: generated client mutation ID.
   - Value: agent ID, case ID, type (`evidence`, `attempt`, or `custody`), payload, evidence blob IDs, dependency mutation IDs, creation time, status (`pending`, `syncing`, or `needs_attention`), attempt count, and last error.

All records are namespaced by the authenticated agent. Another agent using the same device cannot see or submit them. Signing out retains unsynced work for the same agent and removes only replaceable cached workspace data. Successfully synchronized evidence blobs and completed queue entries are deleted locally.

## Queue behavior

- Draft changes persist immediately.
- Captured files are validated before IndexedDB storage: at most five files per evidence batch, 15 MB per file, and only supported JPG, PNG, WebP, MP4, or WebM types.
- An evidence mutation owns the selected local blobs.
- A custody mutation depends on any evidence mutation created for that work order. It cannot run until its evidence dependency has completed.
- A failed-attempt mutation has no evidence dependency.
- The queue runs on app startup, successful login, the browser `online` event, and manual retry.
- Automatic synchronization is foreground-based. Background Sync is not treated as a durability guarantee because browser and Android versions may suspend it.
- One mutation is submitted at a time in creation order. A failed dependency prevents its dependent custody mutation from running.
- Network errors return the mutation to `pending`.
- Authentication errors pause the queue without deleting records and require OTP sign-in.
- Server validation or stale-case conflicts move the mutation to `needs_attention` with the server's safe error message.
- The sync screen always exposes pending work and a manual retry action. Work is never silently discarded.

## Idempotent field APIs

Every queued request sends its client mutation ID in the `Idempotency-Key` header. The server adds a `field_mutation_receipts` table with:

- tenant ID
- agent user ID
- client mutation ID
- case ID
- operation type
- HTTP response status
- serialized safe response body
- creation timestamp

The unique key is `(tenant_id, agent_user_id, client_mutation_id)`. A retry with the same case and operation replays the stored response. Reusing a key for another case or operation returns a conflict. This makes a lost network response safe to retry without duplicating evidence, failed-attempt updates, or custody certificates.

The idempotency check runs before multipart evidence files are accepted. Original evidence processing cleans up files if the database transaction fails. Evidence records and the mutation receipt commit together. Attempt state and its receipt commit together. Custody state, custody record, note, audit event, and receipt commit together.

## Server data changes

- Add the idempotency receipt table and migration record.
- Add `custom_note` to custody records and API mapping.
- Continue storing the agent-entered arrival time already supported by the custody record.
- Make the custody custom note visible in finance review.
- Add an optional case ID to notifications so an assignment notification can open its work order without parsing display text.
- Return only directly addressed notifications to agents; tenant-wide finance notifications must not leak into agent workspaces.
- Add per-user notification read receipts so shared finance notifications are not marked read for every user when one user reads them.
- Preserve existing permission middleware, assigned-case checks, file-content validation, and tenant scoping.

## Session restoration

The current application clears a stored session after any failed `/api/me` request. The mobile version distinguishes an HTTP `401` from a network failure:

- `401` clears the invalid session and requires OTP sign-in.
- Offline or unreachable-server errors retain the stored agent session and open the cached assigned workspace in offline mode.
- Mutations never synchronize until the server has revalidated the session.

## Screen design

### Agent home

- Shows active, submitted, and needs-attention counts.
- Shows only assigned work-order cards.
- Separates active and submitted work.
- Displays connection state and queued-operation count.
- Provides refresh, notification, sync, and sign-out controls.

### Notifications

- Shows agent-addressed assignments and later finance updates.
- Shows unread count and mark-all-read.
- Opens the matching assigned work order when a case reference is available.

### Work-order details

- Shows customer, loan, vehicle, finance instruction, and approved-authority state.
- Provides call and Maps actions.
- States the no-force, mismatch, authority, and unsafe-situation stop conditions.
- Submitted work orders are read-only and display their finance status.

### Vehicle verification

- Requires registration and chassis-last-six matching.
- Requires a captured GPS position before continuing.
- Prevents later steps from being entered until verification succeeds.

### Evidence

- Supports camera or gallery selection.
- Shows local thumbnails or file rows with removal before queuing.
- Shows queued, uploading, uploaded, and failed states.
- Allows progression only when server evidence already exists or a valid evidence mutation has been queued.

### Digital custody slip

- Requires all 14 known vehicle-condition fields.
- Captures parking location, arrival time, daily rate, and custom note.
- Requires final handover confirmation.
- Queues evidence first and custody second when offline.

### Unable to recover

- Uses the approved reason list and a required factual custom note.
- Includes current GPS when it was safely captured.
- Can queue offline and retry idempotently.

### Pending sync

- Lists each queued operation with case, type, time, attempt count, and status.
- Explains whether it is waiting for connectivity, waiting for evidence, syncing, or needs attention.
- Provides manual retry. This version does not provide a destructive discard action.

## Interaction and accessibility

- Target a 390 by 844 CSS-pixel Android viewport while remaining usable from 360 to 480 pixels wide.
- Use at least 44-pixel primary touch targets.
- Keep visible labels, focus indicators, semantic headings, dialog names, status announcements, and error alerts.
- Prevent step-navigation buttons from bypassing prerequisites.
- Restore focus when dialogs close and support Escape in browser testing.
- Do not depend on color alone for offline, queued, successful, or failed states.

## PWA and Android preparation

- Preserve standalone display mode and the finance brand.
- Add installable 192-pixel and 512-pixel app icons and a maskable icon.
- Keep the service worker on static-shell caching only.
- Add a Capacitor configuration using the production `dist` directory.
- Add the Capacitor core, CLI, and Android packages at one pinned compatible version.
- Generate the Android project and add scripts for web build, Capacitor synchronization, and opening Android Studio.
- Configure the Android application ID as `in.handoff.recovery` and application name as `Handoff Field`.
- Do not embed server secrets, database credentials, or a production API token in the Android project.

The future production API origin will be configured at build/deployment time. Local browser development continues using Vite's `/api` proxy. Android emulator or device networking is not declared complete until a reachable production or LAN API origin is supplied.

## Error handling

- Network failures remain pending and show an offline explanation.
- `401` responses pause synchronization and request OTP sign-in.
- `403` responses become needs-attention permission errors.
- `404` and active-case conflicts refresh the workspace and keep the local record visible for reconciliation.
- `422` validation responses remain needs attention and show the server message.
- Evidence quota or IndexedDB failures block capture with a clear instruction before the agent leaves the screen.
- UI actions disable only while their own operation is active and never hide a failure.

## Verification and acceptance

Automated coverage must prove:

- IndexedDB draft and blob persistence across a simulated app restart.
- Queue ordering and evidence-to-custody dependencies.
- Network retry, authentication pause, needs-attention handling, and cleanup after success.
- Server idempotency replay and conflicting-key rejection.
- Assigned-case and tenant boundaries for field mutations and notifications.
- Custody custom-note persistence and finance mapping.
- Session restoration keeps offline agent access but clears confirmed invalid sessions.
- Service-worker policy never caches API or evidence responses.
- Manifest and Capacitor configuration contain the agreed application identity and build directory.

Browser acceptance must exercise the field-agent login, assigned-case list, vehicle matching, GPS failure/success handling, evidence selection, offline queuing, reconnect synchronization, failed-attempt reporting, custody completion, notification inbox, submitted read-only state, and financier receipt of the field update at a mobile viewport.

Release verification requires the complete automated suite, production web build, clean diff check, database integrity check, fresh database backup, and successful Capacitor Android synchronization. Final APK compilation is deferred only because the Android SDK/Gradle toolchain is not installed on this machine.
