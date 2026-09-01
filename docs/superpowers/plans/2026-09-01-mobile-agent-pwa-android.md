# Mobile Agent PWA and Android Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the assigned-agent mobile workflow as a durable offline PWA and prepare the same production build as a Capacitor Android project.

**Architecture:** Keep one React/Vite client and Express/SQLite API. Add idempotent server mutations, per-user notifications, native IndexedDB persistence, and a foreground queue runner; extend the existing role-gated `FieldApp` rather than creating another frontend.

**Tech Stack:** React 19, TypeScript, Vite, Express, Node SQLite, native IndexedDB, Node test runner, fake-indexeddb, Capacitor 8.

**Spec:** `docs/superpowers/specs/2026-09-01-mobile-agent-pwa-android-design.md`

## Global Constraints

- Finance roles remain on the desktop interface; only `agent` receives the mobile interface.
- Agents see only directly assigned cases and directly addressed notifications.
- Borrowers and parking yards receive no application accounts.
- English only; Android viewport target 390 by 844 CSS pixels, usable from 360 to 480 pixels.
- API/evidence responses are never service-worker cached.
- Offline work is never silently discarded; synchronized blobs are removed locally.
- Evidence stays limited to five JPG, PNG, WebP, MP4, or WebM files per batch and 15 MB per file.
- All queued field mutations use `Idempotency-Key` and replay safely.
- Use platform APIs and existing dependencies before adding code or packages. The only new runtime packages are pinned Capacitor packages; `fake-indexeddb` is test-only.
- No embedded database credentials, server secrets, production token, or hard-coded production API origin.
- Work inline in the current checkout because the mobile phase depends on the verified uncommitted desktop/API changes already present.

---

### Task 1: Idempotent field mutation ledger and custody note

**Files:**
- Create: `server/field-mutations.mjs`
- Create: `server/migrations/009_mobile_field_offline.sql`
- Create: `test/field-mutations.test.mjs`
- Modify: `server/db.mjs`
- Modify: `server/index.mjs`
- Modify: `server/workflow-persistence.mjs`
- Modify: `server/field-validation.mjs`
- Modify: `test/field-validation.test.mjs`
- Modify: `test/workflow-persistence.test.mjs`
- Modify: `src/types.ts`

**Interfaces:**
- Produces `ensureFieldMutationSchema(database)`, `readFieldMutation(database, identity)`, `saveFieldMutation(database, receipt)`, and `validateIdempotencyKey(value)`.
- Adds `CustodyRecord.customNote?: string`.
- Field routes require `Idempotency-Key` and replay the stored status/body for the same tenant, agent, case, and operation.

- [x] **Step 1: Write failing ledger and custody-note tests**

```js
test('field mutation receipts replay only the same scoped operation', () => {
  const database = fieldDatabase();
  ensureFieldMutationSchema(database);
  saveFieldMutation(database, { tenantId: 't1', userId: 'u1', key: 'm-12345678', caseId: 'RC-1', operation: 'attempt', statusCode: 200, body: { ok: true } });
  assert.deepEqual(readFieldMutation(database, { tenantId: 't1', userId: 'u1', key: 'm-12345678', caseId: 'RC-1', operation: 'attempt' }), { statusCode: 200, body: { ok: true } });
  assert.throws(() => readFieldMutation(database, { tenantId: 't1', userId: 'u1', key: 'm-12345678', caseId: 'RC-2', operation: 'attempt' }), /another case or operation/i);
});

test('custody persistence keeps the agent custom note', () => {
  persistCustody(database, { ...record, customNote: 'Left mirror scratched.' });
  assert.equal(database.prepare('SELECT custom_note FROM custody_records').get().custom_note, 'Left mirror scratched.');
});
```

- [x] **Step 2: Run the focused tests and confirm RED**

Run: `node --test test/field-mutations.test.mjs test/field-validation.test.mjs test/workflow-persistence.test.mjs`

Expected: missing field-mutation module/schema and missing custody note assertions fail.

- [x] **Step 3: Implement the minimum immutable receipt schema**

```js
export function ensureFieldMutationSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS field_mutation_receipts (
    tenant_id TEXT NOT NULL,
    agent_user_id TEXT NOT NULL,
    client_mutation_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN ('evidence','attempt','custody')),
    status_code INTEGER NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, agent_user_id, client_mutation_id)
  );`);
}
```

Add immutable update/delete triggers, `custody_records.custom_note`, migration `009-mobile-field-offline`, field validation capped at 2,000 characters, and mapping to the API custody record.

- [x] **Step 4: Require and replay idempotency keys on evidence, attempt, and custody routes**

Read the receipt before `multer` for evidence. For an original request, commit the business state, audit/notification side effects, and receipt in one SQLite transaction. Delete uploaded files if evidence database persistence fails.

- [x] **Step 5: Run focused and full tests**

Run: `node --test test/field-mutations.test.mjs test/field-validation.test.mjs test/workflow-persistence.test.mjs`

Run: `npm.cmd test`

Expected: all tests pass and retries return the first safe response without duplicate rows.

### Task 2: Per-user notification privacy and read state

**Files:**
- Create: `server/notification-access.mjs`
- Create: `test/notification-access.test.mjs`
- Modify: `server/db.mjs`
- Modify: `server/index.mjs`
- Modify: `src/types.ts`

**Interfaces:**
- Produces `ensureNotificationAccessSchema(database)`, `listNotifications(database, user)`, and `markNotificationsRead(database, user, readAt)`.
- Adds `AppNotification.caseId?: string`.
- `addNotification` accepts optional `caseId`.

- [x] **Step 1: Write failing privacy and read-receipt tests**

```js
test('agents receive only directly addressed notifications', () => {
  assert.deepEqual(listNotifications(database, agent).map((row) => row.id), ['agent-notice']);
});

test('reading a shared finance notification is per user', () => {
  markNotificationsRead(database, managerOne, '2026-09-01T10:00:00Z');
  assert.equal(listNotifications(database, managerOne)[0].read, 1);
  assert.equal(listNotifications(database, managerTwo)[0].read, 0);
});
```

- [x] **Step 2: Run the focused test and confirm RED**

Run: `node --test test/notification-access.test.mjs`

Expected: notification access module is missing.

- [x] **Step 3: Implement notification case IDs and per-user receipts**

Use a `notification_reads(notification_id, user_id, read_at)` primary key. Finance users receive tenant broadcasts plus their direct notices; agents receive only direct notices. Compute `read` from a left join to the current user's receipt.

- [x] **Step 4: Route workspace listing and mark-all-read through the helper**

Assignment notifications pass `caseId`. Other case-specific finance notifications pass their case ID where available.

- [x] **Step 5: Run focused and full tests**

Run: `node --test test/notification-access.test.mjs`

Run: `npm.cmd test`

Expected: agent privacy and independent read state pass.

### Task 3: Typed API failures and offline session restoration

**Files:**
- Create: `src/session-restoration.ts`
- Create: `test/session-restoration.test.mjs`
- Modify: `src/api.ts`
- Modify: `src/Root.tsx`

**Interfaces:**
- Produces `ApiError extends Error { status: number }` and `shouldClearStoredSession(error): boolean`.
- API field methods accept a client mutation ID and send it as `Idempotency-Key`.

- [x] **Step 1: Write failing session behavior tests**

```js
test('only confirmed authentication failures clear a stored session', () => {
  assert.equal(shouldClearStoredSession(new ApiError('expired', 401)), true);
  assert.equal(shouldClearStoredSession(new TypeError('fetch failed')), false);
  assert.equal(shouldClearStoredSession(new ApiError('server down', 503)), false);
});
```

- [x] **Step 2: Run the focused test and confirm RED**

Run: `node --test test/session-restoration.test.mjs`

Expected: missing exports fail.

- [x] **Step 3: Implement typed API errors and safe restoration**

`request` throws `ApiError` for HTTP responses and leaves fetch/network errors unchanged. `Root` clears only on `401`; other restore errors retain the session and let `FieldApp` open its cached workspace.

- [x] **Step 4: Add idempotency headers to field API calls**

Update `recordAttempt`, `uploadEvidence`, and `recordCustody`; evidence accepts preserved `capturedAt` and location values from the queue.

- [x] **Step 5: Run focused and full tests**

Run: `node --test test/session-restoration.test.mjs`

Run: `npm.cmd test`

Expected: offline failures retain sessions and `401` clears them.

### Task 4: IndexedDB field storage and foreground sync

**Files:**
- Create: `src/field-offline.ts`
- Create: `src/field-workflow.ts`
- Create: `test/field-offline.test.mjs`
- Create: `test/field-workflow.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces workspace/draft/blob/mutation persistence functions using `handoff-field-v1`.
- Produces `validateEvidenceFiles(files)`, `canOpenFieldStep(step, state)`, `nextSyncableMutation(mutations)`, and `classifyFieldSyncError(error)`.
- Test environment uses `fake-indexeddb`; production uses native IndexedDB.

- [x] **Step 1: Write failing workflow and persistence tests**

```js
test('custody waits for queued evidence', () => {
  assert.equal(nextSyncableMutation([
    { id: 'custody', status: 'pending', dependencyIds: ['evidence'], createdAt: '2' },
    { id: 'evidence', status: 'pending', dependencyIds: [], createdAt: '1' },
  ]).id, 'evidence');
});

test('drafts and evidence blobs survive a new database connection', async () => {
  await saveFieldDraft('u1', 'RC-1', draft);
  await saveEvidenceBlob(blobRecord);
  assert.deepEqual(await loadFieldDraft('u1', 'RC-1'), draft);
  assert.equal((await loadEvidenceBlobs(['blob-1']))[0].blob.size, 4);
});
```

- [x] **Step 2: Add `fake-indexeddb` as a pinned dev dependency and confirm RED**

Run: `npm.cmd install --save-dev --save-exact fake-indexeddb`

Run: `node --test test/field-offline.test.mjs test/field-workflow.test.mjs`

Expected: missing offline/workflow modules fail.

- [x] **Step 3: Implement native IndexedDB stores**

Open a fresh version-1 connection per operation. Create `workspaces`, `drafts`, `evidenceBlobs`, and `mutations` stores. Use compound string keys `${userId}:${caseId}` where a native compound key adds no value.

- [x] **Step 4: Implement the minimum queue rules**

Validate evidence count/type/size, prevent step bypass, choose the first dependency-ready pending mutation, and classify network/authentication/validation failures. Do not add background-sync or a queue framework.

- [x] **Step 5: Run focused and full tests**

Run: `node --test test/field-offline.test.mjs test/field-workflow.test.mjs`

Run: `npm.cmd test`

Expected: restart persistence, dependency ordering, error classification, and validation pass.

### Task 5: Complete the field-agent mobile UI

**Files:**
- Modify: `src/FieldApp.tsx`
- Modify: `src/styles.css`
- Modify: `README.md`
- Modify: `test/field-workflow.test.mjs`

**Interfaces:**
- Consumes the Task 3 API methods and Task 4 offline/workflow helpers.
- Produces agent home filters, notification view, sync view, durable evidence/custody/attempt queues, and read-only submitted cases.

- [x] **Step 1: Add failing tests for mobile-derived behavior**

```js
test('active and submitted agent work are separated', () => {
  assert.deepEqual(filterAgentCases(cases, 'active').map((item) => item.id), ['active']);
  assert.deepEqual(filterAgentCases(cases, 'submitted').map((item) => item.id), ['submitted']);
});

test('later workflow steps stay locked until prerequisites exist', () => {
  assert.equal(canOpenFieldStep('evidence', { verified: false, evidenceReady: false }), false);
  assert.equal(canOpenFieldStep('custody', { verified: true, evidenceReady: true }), true);
});
```

- [x] **Step 2: Run the focused test and confirm RED**

Run: `node --test test/field-workflow.test.mjs`

Expected: missing filter or incorrect step gate fails.

- [x] **Step 3: Implement cached startup and queue synchronization**

On refresh success, store the agent workspace. On network failure, load it. Queue evidence/attempt/custody with `crypto.randomUUID()`, synchronize on startup/online/manual retry, refresh after success, and keep validation failures visible.

- [x] **Step 4: Implement the approved screens in the existing field surface**

Add active/submitted tabs, notification badge/view, sync badge/view, persisted evidence rows, editable arrival time, custody custom note, read-only submitted state, and named status/error regions. Keep the existing customer, Maps, call, safety, GPS, checklist, and assignment-instruction UI.

- [x] **Step 5: Add mobile interaction and accessibility styling**

Keep 44-pixel touch targets, visible focus, non-color status labels, dialog semantics, and 360-to-480-pixel layouts. Do not introduce a UI library.

- [x] **Step 6: Run focused tests, full tests, and build**

Run: `node --test test/field-workflow.test.mjs test/field-offline.test.mjs`

Run: `npm.cmd test`

Run: `npm.cmd run build`

Expected: all tests and TypeScript/Vite build pass.

### Task 6: PWA assets and Capacitor Android preparation

**Files:**
- Create: `capacitor.config.ts`
- Create: `test/mobile-package.test.mjs`
- Create: `public/icons/handoff-192.png`
- Create: `public/icons/handoff-512.png`
- Create: `public/icons/handoff-maskable-512.png`
- Generate: `android/`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `public/manifest.webmanifest`
- Modify: `.gitignore` if generated Android build outputs are not already ignored
- Modify: `README.md`

**Interfaces:**
- Capacitor app ID `in.handoff.recovery`, name `Handoff Field`, and `webDir: 'dist'`.
- Scripts: `mobile:add`, `mobile:sync`, and `mobile:open`.

- [x] **Step 1: Write a failing executable packaging contract test**

```js
test('mobile package is installable and uses the production web bundle', async () => {
  const config = (await import('../capacitor.config.ts')).default;
  assert.deepEqual({ appId: config.appId, appName: config.appName, webDir: config.webDir }, {
    appId: 'in.handoff.recovery', appName: 'Handoff Field', webDir: 'dist',
  });
  for (const icon of manifest.icons) assert.equal(statSync(join('public', icon.src.replace(/^\//, ''))).size > 0, true);
});
```

- [x] **Step 2: Install pinned Capacitor 8 packages and confirm RED**

Run: `npm.cmd install --save-exact @capacitor/core@8 @capacitor/android@8`

Run: `npm.cmd install --save-dev --save-exact @capacitor/cli@8`

Run: `node --test test/mobile-package.test.mjs`

Expected: missing configuration/assets fail.

- [x] **Step 3: Add config, scripts, and installable PWA icons**

Use the existing Handoff mark for 192, 512, and maskable PNG assets. Update the manifest icon entries and preserve standalone display, theme, start URL, name, and description.

- [x] **Step 4: Generate and synchronize Android**

Run: `npm.cmd run build`

Run: `npm.cmd exec cap add android`

Run: `npm.cmd run mobile:sync`

Expected: `android/` exists and the production bundle is copied. APK compilation is not attempted without Android Studio and the Android SDK.

- [x] **Step 5: Run packaging, service-worker, full-suite, and build checks**

Run: `node --test test/mobile-package.test.mjs test/service-worker-policy.test.mjs`

Run: `npm.cmd test`

Run: `npm.cmd run build`

Expected: all checks pass.

### Task 7: End-to-end acceptance and data-integrity handoff

**Files:**
- Modify only if a reproducible defect is found, following a new failing test first.

**Interfaces:**
- Verifies the completed field workflow against the finance desktop and real local SQLite database.

- [ ] **Step 1: Run authenticated mobile browser acceptance at 390 by 844**

Exercise agent OTP login, active/submitted tabs, notification inbox, work-order privacy, vehicle mismatch/match, GPS failure/success, evidence selection, offline queue visibility, reconnect sync, failed-attempt dialog, custody inputs, and read-only submitted state. Do not perform a high-impact final submission in the browser without action-time confirmation.

- [ ] **Step 2: Verify finance receives synchronized field state**

Confirm the financier workspace shows the agent attempt/custody notification, evidence, GPS, all 14 inspection values, arrival time, parking rate, and custom note.

Live acceptance reached the non-submitting boundary: OTP login, assignment privacy, active/submitted states, direct notifications, authority display, locked steps, required attempt notes, read-only reports, and the sync screen passed. GPS permission and a real attempt/custody synchronization remain unchecked because they would capture device location or change a recovery case.

- [x] **Step 3: Run final automated verification**

Run: `npm.cmd test`

Run: `npm.cmd run build`

Run: `git diff --check`

Expected: zero failures; only any documented non-blocking bundle-size warning may remain.

- [x] **Step 4: Verify and back up SQLite**

Run: `npm.cmd run db:backup`

Run a read-only `PRAGMA integrity_check`, list migrations through `009-mobile-field-offline`, and confirm immutable triggers for audit events, monthly snapshots, release passes, and field mutation receipts.

- [x] **Step 5: Update the execution plan checkboxes and report the Android toolchain boundary**

Mark every completed item, leave the app open on the agent home screen, and state that final APK compilation requires Android Studio 2025.2.1 or later plus an API 24+ Android SDK, as required by Capacitor 8.
