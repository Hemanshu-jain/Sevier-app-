# 1. CANONICAL NAMING

This is a delta handoff. It assumes the reader has already read README.md and both files under docs/superpowers. It records decisions, contradictions, production gaps, and conversation context that those files do not make explicit.

## Final names

- **Handoff** is the canonical product and browser-app name.
- **Handoff Field** is the Android/PWA display name for the agent experience. It is not a separate product.
- **Seizure agent** is the current domain label for the independent field worker. “Caesar” was only speech-to-text noise. Prefer “field recovery agent” in future customer-facing copy if legal/compliance review finds “seizure agent” too aggressive.
- **Sevier-app-** is only the existing GitHub repository slug, including its spelling and trailing hyphen. Do not use “Sevier” as a product name, and do not create a replacement repository without the owner's approval.
- **Seizer** survives only in technical leftovers: the npm package name, SQLite filename, an API startup log, and the former project vocabulary. These can be renamed later, but a database-file rename needs an explicit data migration so an existing server/data/seizer.db is not silently abandoned.
- **Recoverly** is an abandoned prototype name. It appears only in legacy-prototype.

## Legacy files

- **legacy-prototype/** has no imports, runtime references, build references, or required assets. It is safe to delete once nobody needs it as a visual-history reference. Git history already preserves it.
- **src/data.ts** is another legacy artifact. It contains stale hardcoded agents, cases, custody records, and notifications and is not imported by the current application. It is safe to delete after one final reference search.
- Deleting either directory/file is cleanup, not a prerequisite for production work. Do not mix that deletion into a database or security migration.

# 2. PRODUCT CONTEXT

## Real buyer and operating model

The intended buyer is an Indian vehicle finance company. No actual finance-company customer has been named or integrated yet; “Aarya Finance” and “Sample Finserv” are invented demo tenants, not prospects or clients.

Terminology used in the discovery conversation:

- **Client / owner / financier / finance company** all referred to the company buying Handoff and funding the vehicle loan. Finance managers and staff work inside that tenant.
- **Customer** means the borrower whose financed vehicle may be recovered. The borrower is not an app user.
- **Seizure agent** means an external, independent field worker who physically locates and recovers a vehicle. Agents work individually; the current product must not assume they belong to a recovery agency.
- **Parking yard** is an external partner arrangement between agents/agencies and yard operators. Yard operators are not app users in the approved scope.

The operational source of work is a monthly delinquency list supplied by the financier. Handoff does not itself decide that a borrower is in default, calculate legal eligibility, or query a lender core system. The finance company reviews the account, uploads or enters it, approves the recovery authority, and directly assigns the vehicle to an independent agent.

The agent receives the borrower name, mobile number, address, loan/account context, vehicle registration, make/model/type, chassis information, finance instructions, and authority-approved state. The financier does **not** provide a live vehicle location. Finding the vehicle is the field agent's job; the customer address and external Maps link are only starting information. Both two-wheelers and four-wheelers are in scope.

## Two documents that must remain distinct

The original conversation used “seizure token” for two different documents. They must not be collapsed:

1. **Custody certificate / digital parking check slip**: created by the agent after physical recovery and parking. It reports condition, evidence, arrival, yard, and parking rate to the finance company.
2. **Customer release pass / token receipt**: created by the finance company only after it manually confirms all required dues are cleared. The borrower takes the printable pass to the parking location to claim the vehicle.

The custody certificate proves intake into custody. The release pass authorizes handover out of custody. A future schema and UI should consistently use those two names.

## Paper-slip details behind the checklist

The reference image supplied during discovery was a “Receipt cum check slip” from a Hyderabad parking operator. It drove the following required inspection fields:

- Battery
- Spare tyre
- Fuel level
- Matting
- Keys and key number
- Meter / odometer
- Existing damages
- Self motor
- Wiper / motor
- Stereo / infotainment
- Ignition coil
- Speakers
- Side mirrors
- Tyre condition

The same paper process also captured vehicle number, financier/customer name, vehicle type, yard arrival time, daily parking rate, agent/person-delivering signature, and parking-manager signature. The current app records the core data but does not implement signatures or a yard-manager workflow.

## Business rules and boundaries not fully expressed in code

- Most cases are expected to end in recovery. When recovery fails, the agent needs a standard reason plus a free-form factual note. The note is not optional for a failed attempt.
- Finance users may assign directly; agent acceptance/decline was not required for the approved mobile phase.
- Payment clearance is controlled and attested manually by the financier. Handoff must not infer payment from a typed amount or let an agent clear it.
- The borrower gets a printable document, not a login. The yard gets no account or operational integration for now.
- Auctions, deficiency-balance collection, buying seized vehicles, loan servicing, and borrower payment collection are outside this product.
- “Vehicle roaming without a legal permit” was informal discovery wording and must not become a product or legal claim. Handoff records that the finance company approved an authority document; it does not prove that a repossession is lawful in a particular state or circumstance.
- The real operation must prohibit force, threats, breach of locked premises, unsafe confrontation, and work without valid authority. The app can enforce stop reasons and an approval record, but it is not a substitute for Indian legal review, lender policy, notices, consent/privacy obligations, or agent training.
- Before production, counsel and the finance company's compliance team must approve the workflow, document wording, retention periods, location/evidence collection, borrower-data access, and state-specific recovery practice.

# 3. CURRENT STATE — WHAT'S REAL VS STUBBED

The UI is no longer a static mock, but several production-looking surfaces still terminate in local or manual behavior. Treat the following as the authoritative distinction.

## Authentication and identity

- **Real:** OTP challenges expire, repeated requests are limited per mobile, challenges are one-use, session tokens are random, only token hashes are stored in SQLite, sessions expire after eight hours, logout revokes the current session, and suspending a user revokes that user's sessions.
- **Development stub:** when NODE_ENV is not exactly production, the provider accepts DEV_OTP_CODE, defaulting to **123456**, and the login UI displays it.
- **Partially real:** the MSG91 adapter sends and verifies through MSG91 HTTP endpoints, and unit tests use a fake fetch. No live MSG91 account, approved template, delivery test, or production end-to-end verification has occurred.
- **Missing:** first-tenant/owner bootstrap, invitation, mobile-number change, account recovery, device enrollment, and production-safe generic login responses. Requesting an OTP currently reveals whether an active account exists.
- **Security caveat:** the browser/Capacitor client stores the bearer token and user object as plaintext JSON in localStorage. Hashing on the server protects the database copy, not the token on the device. There is no native secure-storage plugin, device binding, remote wipe, or refresh-token flow.

## Database and durable data

- **Real for local development:** every active API route reads and writes server/data/seizer.db through Node's built-in SQLite driver. WAL, full synchronous writes, foreign keys, a five-second busy timeout, transactions, several immutable triggers, daily local snapshots, and a manual backup command are present.
- **Production stub:** DATABASE_URL is validated in production configuration but never opened. There is no PostgreSQL client, repository implementation, migration runner, connection pool, or PostgreSQL integration test.
- **Dangerous default:** seedIfEmpty runs regardless of NODE_ENV. Because the server always uses SQLite, an empty “production” process would insert all demo tenants, users, and cases.
- **Local only:** database files, backups, and uploads are gitignored and host-local. Nothing copies them off the machine.

## Evidence and authority documents

- **Real locally:** agents can queue evidence blobs in IndexedDB, upload supported photo/video signatures, persist evidence metadata in SQLite, and finance users can retrieve files only through tenant/case authorization. Authority PDF/JPG/PNG contents are signature-checked and SHA-256 is stored.
- **Storage stub:** OBJECT_STORAGE_ENDPOINT and OBJECT_STORAGE_BUCKET are validated but unused. All uploaded evidence and authority documents are written to server/uploads on the API host.
- **Missing controls:** no object-storage credentials, encryption policy, malware scan, EXIF/privacy stripping, lifecycle/retention job, orphan cleanup, replication, or off-host backup. Evidence rows do not store a SHA-256 digest even though authority documents do.
- **Non-atomic edge:** filesystem writes and database commits are not one atomic unit. Evidence files are deleted on a database failure, but authority-document failure cleanup is not equivalently protected.

## Notifications

- **Real:** in-app notification records, tenant/direct-recipient visibility, case links, and per-user read receipts are persisted.
- **Stubbed relative to production expectations:** there is no FCM/web-push provider, device-token table in the live schema, background worker, OS notification, delivery receipt, retry policy, or deep-link handling from a system notification.
- **Limitation:** “mark read” marks every currently visible notification; there is no single-notification endpoint, pagination beyond the latest 50, or retention job.

## Finance workflow

- **Real:** monthly CSV/XLSX parsing, duplicate-file detection, immutable monthly snapshots, manual account correction before authority approval, direct agent management/assignment, finance-user management, tenant reports, audit rows, custody review, payment gating, release-pass persistence, and case closure all change SQLite state.
- **Manual integration, not payment processing:** payment confirmation is a checkbox plus a typed finance reference. There is no lender-core, bank, receipt, UPI, accounting, or payment-gateway verification.
- **Manual legal attestation:** authority approval means a finance user uploaded a file and checked a box. There is no e-signature validation, notice service, policy engine, expiry date, revocation endpoint, or external legal-system check.
- **Misleading metric:** every API agent response sets completedThisMonth to zero. The card looks like a computed KPI but is not implemented.
- **Limited reports:** the CSV and latest-100 audit view are real, but there are no scheduled reports, reconciliation exports, import-history screen, accounting integration, or audit pagination.

## Custody and release documents

- **Real:** custody submissions require at least one server evidence record, all 14 condition values, yard, arrival time, parking rate, and optional custom note. Release records receive random IDs/codes and are immutable in SQLite. Browser print CSS produces a printable handover sheet.
- **Not a real QR:** the square shown in the release UI/printout is a styled placeholder/manual code block, not QR-encoded data.
- **Not one-time verification:** despite UI/README wording, there is no verification endpoint, redemption/consumption record, expiry, revocation flow, yard view, or cryptographic signature. “Close case” is a finance-side checkbox and is the only handover confirmation.
- **Not a PDF artifact:** printing relies on the browser print dialog. The server does not generate, sign, hash, store, or reproduce a PDF.
- **Missing review path:** finance can approve custody but cannot request changes. The PostgreSQL design anticipates both decisions, but the runtime does not.

## Mobile/PWA/Android

- **Real in source:** the role gate sends agents to FieldApp; finance users stay in the desktop UI. IndexedDB stores the latest agent workspace, per-case drafts, evidence blobs, and mutation queue. Idempotency receipts prevent the same agent mutation ID from creating a second server result. The queue sends one mutation at a time while the app is open and online.
- **Not background synchronization:** no Background Sync API, native worker, or background upload is implemented. Closing or suspending the app stops delivery.
- **PWA limitation:** the service worker runtime-caches eligible public GET assets after they are requested; it does not pre-cache an explicit application shell. A first launch cannot work offline, and offline reliability depends on a prior successful load.
- **Android wrapper only:** android/ is a generated Capacitor project. No debug APK was successfully completed, no signed release APK/AAB exists, and nothing has been installed on a physical phone as a release candidate.
- **Browser APIs, not native plugins:** location uses navigator.geolocation and evidence capture uses a file input with capture hints. There is no Capacitor Camera, Geolocation, Filesystem, Secure Storage, or Push Notifications integration.
- **Build-time coupling:** VITE_API_ORIGIN is compiled into the web bundle. Changing the API host requires rebuilding/synchronizing the Android app.
- **No anti-spoofing:** GPS values are device-reported coordinates. There is no mock-location detection, route tracking, continuous tracking, or proof that a photo was taken at the reported location.

## Hardcoded demo and stale data

On an empty SQLite database, server/db.mjs unconditionally creates:

| Tenant | User | Role | Mobile | Notes |
|---|---|---|---|---|
| Aarya Finance Pvt. Ltd. | Arun Mehta | super_admin | +91 98450 11111 | default finance login |
| Aarya Finance Pvt. Ltd. | Divya Rao | finance_manager | +91 98450 11112 | operations/approvals |
| Aarya Finance Pvt. Ltd. | Nisha Verma | finance_staff | +91 98450 11113 | inserted by a later compatibility seed |
| Aarya Finance Pvt. Ltd. | Ravi Kumar | agent | +91 98451 22014 | default field login |
| Aarya Finance Pvt. Ltd. | Ayesha Shaikh | agent | +91 99018 45107 | demo agent |
| Aarya Finance Pvt. Ltd. | Naveen Reddy | agent | +91 97319 00682 | demo agent |
| Sample Finserv Ltd. | Sample Finserv Admin | super_admin | +91 90000 10000 | tenant-isolation fixture |

All original seeded users have a bcrypt hash of **demo123**, although no password-login route consumes it. Newly created OTP-only users receive the literal placeholder password hash “otp-only.” Seeded email addresses end in .test; generated user addresses end in handoff.invalid.

The seeded Aarya cases are RC-260801, RC-260798, RC-260792, RC-260787, RC-260780, and RC-260774, with fake Bengaluru/Mysuru borrowers, vehicles, loan amounts, and statuses. CT-260078 and CT-260077 are fake custody records at Sri Lakshmi Parking. Notifications n-1 through n-3 are fake. Older non-imported demo cases are backfilled with synthetic “legacy authority” metadata, and any old release rows are backfilled with LEGACY verification codes.

src/data.ts duplicates much of that sample set but also contains stale records that are not in the live database, including Harish Patel and CT-260071. It does not drive the UI.

# 4. ENVIRONMENT & SECRETS

## Variables recognized today

| Variable | In .env.example | Consumer and actual behavior | Production note |
|---|---:|---|---|
| NODE_ENV | yes | server/config.mjs chooses development OTP unless value is exactly production | Must be production in the real API process; otherwise 123456-style OTP remains active |
| PORT | yes | Express listen port, default 8787 | Put behind HTTPS reverse proxy/load balancer |
| DATABASE_URL | yes | validated and exposed in config only | Currently unused; setting it does not enable PostgreSQL |
| OBJECT_STORAGE_ENDPOINT | yes | validated and exposed in config only | Currently unused |
| OBJECT_STORAGE_BUCKET | yes | validated and exposed in config only | Currently unused |
| MSG91_AUTH_KEY | yes | live OTP send/verify when NODE_ENV=production | Secret; create in MSG91 |
| MSG91_OTP_TEMPLATE_ID | yes | live OTP template ID | Create/approve in MSG91; Indian DLT/sender/template requirements must also be completed where applicable |
| PUBLIC_WEB_URL | yes | validated and exposed in config only | Currently unused; should become canonical HTTPS URL for release verification/deep links |
| DEV_OTP_CODE | yes | development-only OTP, default 123456 | Never set or honor in production |
| VITE_API_ORIGIN | no | Vite build-time public API origin used by browser/Android fetches | Required for Android and any separately hosted frontend; must be a reachable HTTPS origin in release builds |
| HANDOFF_API_HOST | no | **Uncommitted local change only**; selects Express listen host, default 127.0.0.1 | Set to 0.0.0.0 only for controlled LAN/container binding; committed main still binds 127.0.0.1 directly |
| HANDOFF_ANDROID_BUILD_DIR | no | **Uncommitted local change only**; redirects Gradle build output | Build-machine convenience, not an application setting or secret |

There is no dotenv dependency and the npm server scripts do not pass Node's env-file option. A repository .env file is ignored by Git but is **not automatically loaded by npm run dev, npm start, or server/index.mjs**. Export variables in the process/service environment, use a deployment secret manager, or deliberately add env-file loading. Vite does load its own .env conventions for VITE-prefixed build values; remember those values are public in the bundle.

## Production variables that still need an implemented contract

The following names are recommended so the next agent has a concrete target, but the current code does not read them. Add only the values needed by the chosen providers:

- **CORS_ALLOWED_ORIGINS** — comma-separated exact HTTPS frontend origins; replace origin: true.
- **TRUST_PROXY_HOPS** — explicit Express proxy trust so request IPs/rate limits work behind the deployment proxy.
- **DATABASE_SSL_MODE** and, if required, **DATABASE_SSL_CA** — provider-specific PostgreSQL TLS verification. Do not turn verification off merely to make deployment pass.
- **OBJECT_STORAGE_REGION**
- **OBJECT_STORAGE_ACCESS_KEY_ID**
- **OBJECT_STORAGE_SECRET_ACCESS_KEY**
- **OBJECT_STORAGE_PUBLIC_BASE_URL** only if any objects are intentionally public; evidence should not be.
- **FCM_PROJECT_ID**
- **FCM_SERVICE_ACCOUNT_JSON** or **GOOGLE_APPLICATION_CREDENTIALS** — choose one secret-delivery method for server push, not both.
- **WEB_PUSH_VAPID_PUBLIC_KEY** and **WEB_PUSH_VAPID_PRIVATE_KEY** only if browser PWA push is delivered in addition to native FCM.
- **RELEASE_PASS_SIGNING_PRIVATE_KEY**
- **RELEASE_PASS_SIGNING_KEY_ID**
- **RELEASE_PASS_VERIFICATION_TTL_DAYS**
- **ANDROID_KEYSTORE_PATH**, **ANDROID_KEYSTORE_PASSWORD**, **ANDROID_KEY_ALIAS**, and **ANDROID_KEY_PASSWORD** for CI release signing. Keep the keystore and secrets outside Git.

No variable exists for the SQLite path, upload directory, backup directory, session duration, OTP limits, evidence limits, or retention period. Those values are currently hardcoded.

## Accounts/infrastructure still required

Before a real deployment, create or select:

1. A managed PostgreSQL instance with TLS, automated backups, point-in-time recovery, monitoring, and a least-privilege application role.
2. Private S3-compatible object storage with versioning/lifecycle policy, server-side encryption, restricted CORS, and an application service credential.
3. An MSG91 account, authentication key, approved OTP template, sender configuration, and any required Indian DLT registration.
4. A public HTTPS API hostname, DNS, certificates, reverse proxy/load balancer, and secret manager.
5. A Firebase project/FCM service identity for native Android push; add web-push credentials only if browser push is actually required.
6. An Android release keystore and, when distribution is intended, a Google Play Console account. The current package ID is in.handoff.recovery.
7. Central logging/error monitoring and off-host database/object backup monitoring. None is integrated today.

# 5. DATABASE STATE

## What happened to migrations 002–008

They were **not created as SQL files, were not squashed into 001, and were not intentionally skipped by a migration runner**. There is no migration runner.

server/db.mjs and its ensure helpers mutate the SQLite schema on startup and then insert nine labels into schema_migrations:

| Recorded label | What it informally represents |
|---|---|
| 001-initial-tenant-workflow | first SQLite tenant/user/case tables |
| 002-evidence-and-durable-settings | evidence plus local durability work |
| 003-structured-inspection-checklist | inspection JSON |
| 004-release-pass-ledger | release_passes and immutability |
| 005-finance-approval-gates | authority/payment/review columns |
| 006-otp-sessions | normalized mobiles, OTP challenges, sessions |
| 007-monthly-import-snapshots | import batches and monthly snapshots |
| 008-assignment-notes | assignment_note column |
| 009-mobile-field-offline | mutation receipts, notification reads/case IDs, custody custom note |

Those rows are bookkeeping assertions, not proof that a corresponding file ran. Startup inserts them even though files 002 through 008 do not exist. Do not build production deployment logic around this ledger.

## SQLite is not 100% synchronized with the SQL files

It is definitively **not** in sync:

- 001_initial.sql is a PostgreSQL domain design, not the schema created by server/db.mjs.
- 009_mobile_field_offline.sql is SQLite-flavored and cannot be applied as-is to the PostgreSQL schema. It uses TEXT case IDs and SQLite RAISE(ABORT) triggers, while 001 uses UUIDs and PL/pgSQL.
- server/db.mjs never reads either migration file.
- The SQLite ensure helper for notification_reads omits the foreign keys and ON DELETE CASCADE written in 009.
- SQLite retains a legacy notifications.read column even though current read state comes from notification_reads.
- The live database marks 009 applied because the helper ran, not because the SQL file ran.

As of 2026-09-02, a read-only PRAGMA integrity_check on the local server/data/seizer.db returned **ok**, and its schema_migrations table contains all nine labels. That validates the local file's physical integrity only; it does not validate migration correctness or PostgreSQL parity.

## Major PostgreSQL/SQLite model differences

| Concern | PostgreSQL 001 design | Live SQLite runtime |
|---|---|---|
| Tenant and users | organizations, global users, organization_memberships | tenants and tenant_id directly on users |
| Roles | organization roles plus role_permissions | fixed role string on users; permissions derived in JavaScript |
| Platform/device control | platform_admins and agent_devices | absent |
| Loan identity | loan_accounts separate from recovery_cases | borrower, vehicle, loan, balance flattened into recovery_cases |
| Money | snapshot/payment amounts in paise BIGINT | recovery_cases.pending_amount is treated as rupees; snapshots use paise; SQLite can retain fractional values despite INTEGER declaration |
| Status vocabulary | canonical lowercase snake_case | human display strings such as Imported, Assigned, Custody review, and Release pass printed |
| Assignment history | case_assignments with offer/accept/decline/revoke | assigned user/time/note overwritten on recovery_cases |
| Failed attempts | immutable field_attempts rows with outcome/GPS | latest failure fields overwrite recovery_cases; detail survives only as audit text |
| Evidence | evidence_objects with hash/object key | evidence with local filename and no SHA-256 |
| Custody review | custody_reviews history with approve/change request | review columns updated on custody_records; approve only |
| Payment | immutable payment_confirmations | mutable payment fields on recovery_cases |
| Release lifecycle | revoke/release fields on release_passes | immutable pass row with no revoke/redeem state; case close is separate |
| Audit | JSONB detail and request IP | plain text detail; no request IP |
| Retention/legal hold | retention_policies and legal_holds | absent |

The shared/contracts.mjs state machine uses the PostgreSQL-style snake_case statuses, but the running API never uses that state machine. Its tests can pass while the real API follows a separate string-based workflow. Unifying this is mandatory before PostgreSQL work.

## Production migration consequences

- Do not point DATABASE_URL at PostgreSQL and expect the app to work.
- Choose one canonical model first. The recommended direction is the normalized PostgreSQL model, updated for the offline/idempotency additions and the actual product decisions.
- Write a valid ordered PostgreSQL migration chain and a migration command that records only migrations actually executed.
- Write an explicit one-time SQLite-to-PostgreSQL data conversion. It must map tenant users to memberships, human statuses to canonical statuses, rupees to paise, flattened cases to loan accounts/snapshots/cases, and legacy assignment/failure/payment/release data to historical rows without fabricating facts.
- Remove or environment-gate demo seeding before any production database is initialized.
- Preserve the existing SQLite file until record counts, tenant scoping, financial totals, object hashes, release codes, and audit counts are reconciled in PostgreSQL.

# 6. KNOWN BUGS / INCOMPLETE WORK

## Current working-tree condition

The last pushed commit is **a8a9780 feat: complete recovery operations platform** on origin/main. The local branch is codex/desktop-foundation and currently has uncommitted Android-debug preparation:

- android/build.gradle — optional HANDOFF_ANDROID_BUILD_DIR
- server/config.mjs — optional HANDOFF_API_HOST
- server/index.mjs — listens on the configured host
- test/config.test.mjs — LAN-listen test
- test/mobile-package.test.mjs — debug-manifest/build-directory assertions
- android/app/src/debug/AndroidManifest.xml — cleartext HTTP allowed only in debug

These changes were made while trying to produce a downloadable debug APK. They are reasonable development changes but have not been committed, pushed, or re-verified with the complete suite. Review and either finish or revert them as one coherent change; do not accidentally lose them.

The APK build was interrupted by an almost-full C: drive. Portable tools now exist outside the repository at:

- F:\handoff-android-build\jdk\jdk-21.0.12.1+1
- F:\handoff-android-build\android-sdk

Android API 36, build-tools 36.0.0, and platform-tools were installed there. F:\handoff-android-build\project-node_modules is only a partial copy and must not be treated as a valid dependency installation.

The repository's node_modules was incomplete and has now been removed except for a locked residual native binary directory. npm ls had reported nearly every top-level dependency missing. A 2026-09-02 npm test run produced 79 passing tests and three file-load failures because read-excel-file and fake-indexeddb were missing; there were zero skipped and zero todo tests. Before the interrupted relocation, the committed tree passed 86 tests; the uncommitted config change adds one more, so a repaired installation should expose 87 tests. Run npm ci on a volume with enough space before interpreting current failures as code regressions.

## Functional gaps that are easy to miss

- No APK/AAB exists, no release signing exists, and no physical-device full workflow has passed.
- The plan's two unchecked live acceptance steps remain important: real GPS permission, evidence selection, offline queue/reconnect, actual custody submission, and finance-side receipt have not been proven together. Earlier browser acceptance deliberately stopped before capturing location or mutating the final field case.
- No Express route-level test starts the API and exercises the complete HTTP workflow. Most tests cover helpers, schema fragments, or UI-independent logic.
- The “canonical” shared state-machine test is disconnected from the human-string states used by the running server.
- The mobile packaging test verifies files/configuration strings; it does not invoke Gradle, assemble an APK, install it, or launch it.
- OTP tests mock fetch. They do not prove MSG91 credentials, templates, DLT setup, delivery, or verification.
- IndexedDB tests use fake-indexeddb. They do not prove Android WebView quota, camera blobs, process death, storage pressure, or OS cleanup behavior.
- Service-worker tests validate the cache policy function, not an installed offline PWA lifecycle.
- No PostgreSQL, object-storage, proxy, CORS, push, or release-verification integration test exists.
- The full production build previously completed with a non-blocking roughly 759 KB JavaScript chunk warning. Code splitting was deferred; revisit only if measured mobile startup warrants it.
- The last dependency audit had no production vulnerabilities, but three moderate development-only findings came through the Capacitor CLI/xcode/uuid chain. A forced audit fix wanted to downgrade Capacitor CLI and was intentionally not applied. Re-run the audit after npm ci because registry results can change.

## Workflow and data bugs

- Demo seeding is unconditional and can contaminate a production-mode SQLite startup.
- DATABASE_URL, object-storage settings, and PUBLIC_WEB_URL create a false sense of production readiness because they are unused.
- Production role permissions declare organization management, role management, assignment response, attempt review, release revocation, and retention management, but there are no corresponding live endpoints/UI for most of them.
- updateAccount tells the user to revoke authority before editing, but no authority-revocation endpoint or UI exists.
- Release revocation is in permissions and the PostgreSQL design but absent from the running workflow.
- The release “one-time code” is never verified or consumed.
- Reassignment overwrites the prior assignment instead of preserving structured assignment history.
- Failed-attempt resubmission/reassignment clears the structured failure fields; audit text is the only remaining history.
- Some declared/display statuses are legacy-only. No live route produces Accepted, Recovered, or Custody certificate issued.
- Finance cannot request custody changes; it can only approve.
- Closing a case records a finance assertion, not a verifier/yard event, identity check, code consumption, or released timestamp.
- OTP rate limiting is per mobile only, stored in the application database, and has no IP/device/global provider-abuse layer. Expired challenges and sessions are never purged.
- Audit events and notifications have fixed latest-item limits and no pagination or retention enforcement.
- Multer's global error handler says “10 MB or smaller” even when the failed evidence limit is 15 MB.
- The API reflects any CORS origin. Bearer tokens make cross-origin requests possible even without cookies; production must use an allowlist.
- Express proxy trust is not configured, so request IP metadata will be wrong behind a reverse proxy unless deployment fixes it.
- Evidence, drafts, borrower details, and queued operations remain in IndexedDB across sign-out by design to avoid data loss. On a shared/unmanaged phone this is a privacy risk. There is no encrypted storage, remote wipe, retention expiry, or “clear this device after successful sync” policy.
- A queued operation needing attention has no rich correction workflow. The queue shows the error and offers retry, but there is no safe edit/rebase or administrator reconciliation screen and intentionally no destructive discard action.
- The PWA has no update prompt/version migration strategy for queued IndexedDB records.
- API source changes do not hot-reload under npm run dev. Restart the API side manually.
- The committed API binds only to 127.0.0.1, so a physical phone cannot reach it over LAN. The uncommitted HANDOFF_API_HOST/debug-cleartext work addresses local debug only; production Android must use HTTPS and must not enable cleartext in the main manifest.

# 7. ARCHITECTURE DECISIONS AND WHY

These rationales were made during implementation but are not all captured in the design docs.

## One React application with role gating

Finance desktop and agent mobile are separate experiences, not separate repositories or builds. Sharing Root, authentication, API contracts, types, design tokens, and deployment avoided two clients drifting while the product was still being discovered. The role gate is also a security/usability boundary: agents receive the FieldApp and the API independently tenant/assignment-scopes their data. If the products later need independent release cadences, this can become two entry points/packages without first duplicating the domain code.

## Node's built-in SQLite instead of better-sqlite3

The local prototype used node:sqlite to avoid another native module, ABI rebuilds, and Windows install friction. It made a durable local server possible with almost no database dependency. The cost is an ExperimentalWarning on Node 24, a relatively new Node runtime requirement, synchronous database calls, and no claim of production suitability. PostgreSQL was always the intended hosted database.

## Native IndexedDB instead of Dexie/idb

The offline model has four small object stores and simple get/put/delete/list operations. Native IndexedDB avoided a new client dependency and kept the persisted shapes visible. If schema upgrades, complex indexes, cross-tab locking, or conflict resolution expand materially, a wrapper may then earn its cost; do not add one merely for syntax.

## Express monolith and local files

One Node process was the shortest path to prove tenant permissions and the whole finance/field lifecycle. Local multer storage made evidence review testable before a provider was chosen. Neither choice implies that local disk or one process is the final production topology. Keep the API modular, but avoid introducing microservices until throughput, team boundaries, or independent failure domains require them.

## Opaque, stateful sessions instead of JWTs

Random bearer tokens are hashed in the database. This permits immediate logout/suspension revocation and avoids signing-key/JWT-refresh machinery for a small product. The tradeoff is a database lookup on every request and device-token exposure in localStorage. A production deployment can retain opaque sessions and move them to PostgreSQL; JWTs are not automatically an upgrade.

## Foreground queue plus server idempotency

Browser/Android background execution is inconsistent, especially for large photo/video uploads. The design therefore promises durability, not invisible background delivery: save first, display pending state, and sync sequentially while foreground/online. Server mutation receipts are scoped by tenant, agent, client mutation ID, case, and operation so retries do not duplicate accepted work. Evidence must sync before dependent custody.

## Database constraints/transactions for irreversible actions

Custody, payment, audit, release, and idempotency records affect legal/financial operations. Where implemented, immutability and atomic state changes live in database transactions/triggers so a UI bug cannot quietly rewrite history. This principle should survive the PostgreSQL rewrite. Do not move these guarantees exclusively into React or route handlers.

## Fixed role templates

Owner, manager, staff, and agent permissions were fixed to make tenant isolation and approval boundaries reviewable. The PostgreSQL schema anticipated custom roles, but custom-role administration was not required or implemented. Keep fixed templates until a real financier asks for organization-specific roles; speculative RBAC editing would increase security surface.

## Manual payment confirmation

The product is an operations system, not a payment processor or loan ledger. The financer remains the source of truth for dues and enters a reference after checking its own system. Integrate a lender core later only through an auditable adapter; never let a field agent or yard operator mark payment cleared.

## No borrower or yard account

The borrower receives paper/PDF; the yard manually checks it. This keeps sensitive case access inside the financier and assigned agent population and matches the discovered business relationship. A minimal public validity page may be added for QR verification without creating a yard tenancy.

## Custody certificate and release pass separation

The split resolves the ambiguous “seizure token” concept and preserves custody chain direction. Agent-issued custody evidence can never substitute for financier-issued release authority. Keep separate tables, permissions, identifiers, and document templates.

# 8. NEXT STEPS (BE SPECIFIC)

Do these in order. PostgreSQL/schema convergence is the dependency for every trustworthy production integration.

## Slice 0 — restore a trustworthy development baseline

1. Move the working copy or dependency/build caches to a drive with several free gigabytes; C: had about 0.15 GB free during this handoff.
2. Run npm ci and confirm npm ls --depth=0 has no missing/extraneous packages.
3. Review the six uncommitted Android-debug files listed above. Keep them only if they pass the full suite and do not weaken the release manifest.
4. Run npm test, npm run build, git diff --check, npm run db:backup, and the read-only SQLite integrity/migration/trigger checks.
5. Build and install a debug APK against a reachable development API, then execute the two unfinished mobile/finance acceptance steps. Record the APK hash and tested device/Android version.

## Slice 1 — make PostgreSQL real

1. Freeze the canonical domain vocabulary. Prefer lowercase machine statuses in the database/API and map them to human display labels in React.
2. Reconcile 001_initial.sql with actual requirements: add valid PostgreSQL versions of field_mutation_receipts, notification_reads, notification case UUID, custody custom note, and any chosen device/push tables.
3. Decide whether 001 is an unreleased baseline that may be replaced. Because no production database exists, the cleanest option is a new internally consistent baseline plus ordered migrations. Do not fabricate empty 002–008 files just to match the SQLite ledger.
4. Add the smallest PostgreSQL runtime layer: pg pool, transaction helper, parameterized repositories, health/readiness checks, and a migration command with an advisory lock. Eliminate direct SQLite SQL from route handlers before claiming parity.
5. Preserve the normalized model: loan accounts, immutable monthly snapshots, assignment history, field attempts, custody reviews, payment confirmations, release lifecycle, audit, retention, and legal holds. Add tenant/organization keys to every access path and enforce composite foreign keys/uniqueness.
6. Remove unconditional seedIfEmpty. Add an explicit development seed command and a one-time production bootstrap command for organization plus owner mobile.
7. Write a one-time importer for server/data/seizer.db. Convert rupees to paise exactly, map every legacy status explicitly, retain original IDs in a legacy-ID column or mapping table, and emit a reconciliation report. Never infer missing legal events.
8. Add PostgreSQL integration tests against an ephemeral real PostgreSQL service. Test tenant isolation, concurrent assignment, duplicate import, idempotent field retries, immutable history, payment/release gates, and rollback behavior through HTTP.
9. Deploy to managed PostgreSQL with TLS, least privilege, automated backups/PITR, migration-before-app startup, connection limits, and restore testing.

## Slice 2 — move documents/evidence to private object storage

1. Implement an S3-compatible adapter using the endpoint/bucket plus credentials. Use opaque tenant/case-prefixed object keys; never use the original filename as a key.
2. Stream uploads, compute SHA-256 for every file, validate magic bytes and limits before finalization, and store object version/ETag/hash/size/MIME in PostgreSQL.
3. Keep objects private. Serve short-lived signed downloads only after the same tenant/assignment authorization currently used by the API.
4. Handle the database/object non-atomic boundary with a staged state and cleanup job or compensating delete. Test failures between upload, row insert, and audit commit.
5. Add malware scanning/quarantine, retention/legal-hold behavior, orphan detection, backup/versioning policy, and audit events for upload/view/delete.
6. Migrate existing server/uploads objects by hashing and reconciling every evidence/authority row before removing local copies.

## Slice 3 — harden and host the API

1. Host the API behind HTTPS. Configure exact CORS origins, proxy trust, request/body limits, security headers, structured logs, request IDs, readiness, graceful shutdown, and secret-manager injection.
2. Add layered OTP/API rate limiting by mobile, IP, tenant, and provider budget. Return a generic OTP-request response to prevent account enumeration.
3. Add cleanup jobs for expired OTP challenges/sessions, notification retention, old offline receipts, and object lifecycle while respecting legal holds.
4. Add production owner bootstrap, tenant administration, support/audit procedures, and an incident/restore runbook.
5. Keep authenticated API/evidence responses non-cacheable and add explicit Cache-Control headers server-side, not only service-worker policy.

## Slice 4 — enable live MSG91

1. Complete MSG91/DLT setup and store the auth key/template ID in the deployment secret manager.
2. Verify the exact provider request/verify contract in a sandbox or low-volume production tenant, including retries, timeouts, template errors, invalid/expired OTPs, and provider outage behavior.
3. Do not log OTPs, auth keys, full provider responses, or full borrower mobiles.
4. Add provider contract tests behind an opt-in environment flag; keep normal CI on deterministic fake transport.
5. Confirm NODE_ENV=production disables the development code and that no response/UI contains developmentCode.

## Slice 5 — add privacy-safe push notifications

1. Add a device installation table keyed to user/tenant with platform, FCM token hash/encrypted token, last-seen time, app version, revoked time, and token rotation.
2. Add the Capacitor Push Notifications plugin for Android. Request permission only after sign-in with an explanation; unregister/revoke on sign-out or suspension.
3. Persist an outbox row in the same PostgreSQL transaction as each assignment/field/payment/release notification. A separate worker sends FCM and records attempts/results. The in-app notification remains authoritative.
4. Push content must be generic, for example “A new work order is available.” Do not place borrower name, mobile, address, registration, loan amount, or yard details on the lock screen.
5. Deep-link only to a case the authenticated user can still access. Handle expired sessions, reassignment, revoked devices, duplicate delivery, token refresh, offline taps, and notification permission denial.
6. Add web push only if installed-browser PWA use is a real requirement; otherwise avoid a second provider path.

## Slice 6 — signed QR/PDF release passes

1. Define a real lifecycle: issued, revoked, redeemed/released, expired, and replaced. One case may have only one active pass, but history must remain immutable.
2. Prefer an asymmetric signing key such as Ed25519 with a key ID. Put only minimal claims in the signed QR token: pass ID, organization ID, issued-at, expiry, nonce, key ID, and perhaps a masked vehicle suffix. Do not embed borrower PII or payment details.
3. Encode a URL such as PUBLIC_WEB_URL/r/{signed-token} into a real QR. The verification endpoint must validate signature, key status, expiry, database status, and pass/case match.
4. The public verification page should disclose the minimum needed to compare the paper to the vehicle—valid/revoked/redeemed state, financer name, pass ID, and masked registration. It must be rate-limited and non-indexed. Because yards are not users, it should be read-only in this phase.
5. Keep redemption/vehicle-release confirmation with an authenticated finance user until a real yard-account requirement is approved. Record verifier, time, reason, and audit event; make repeated redemption visibly fail.
6. Generate a deterministic server-side PDF, store it in private object storage, and record its SHA-256, template version, signing key ID, and immutable issuance data. “Signed PDF” here should mean the QR payload and recorded artifact are cryptographically verifiable; a legal PDF digital signature/Indian DSC is a separate compliance decision.
7. Support revocation/replacement without mutating the issued artifact. Verification must always consult current server state so a correctly signed but revoked pass displays invalid.
8. Test tampering, expired/revoked/redeemed tokens, key rotation, duplicate issuance, tenant boundaries, PDF reproduction, printer layout, and phone-camera scanning.

## Slice 7 — release the Android field app

1. Use a release HTTPS API origin; remove all release cleartext allowances.
2. Add secure token storage and a deliberate policy for encrypted/offline borrower data, queued evidence retention, successful-sync cleanup, shared devices, and remote session/device revocation.
3. Add schema-versioned IndexedDB migrations before changing stored shapes. Test app upgrade with pending evidence and mutations.
4. Assemble signed APK/AAB with controlled versionCode/versionName, reproducible CI, protected keystore secrets, and artifact hashes.
5. Test on representative Android versions/devices: OTP, permissions denied/allowed, camera video/photo sizes, GPS failure/success, airplane mode, process kill, reboot, session expiry, queued sync, token revocation, push, deep links, and finance receipt.
6. Run a pilot with one finance user and one independent agent using non-production or formally approved test cases before live borrower data.

## Slice 8 — compliance and operations

1. Obtain Indian legal/compliance approval for recovery authority, notices, agent conduct, evidence/location collection, customer release wording, identity checks, and retention.
2. Define data classification, least-privilege support access, audit review, export/delete/legal-hold procedures, incident response, and breach notification ownership.
3. Add operational dashboards for database/storage/OTP/push health, queue age, failed outbox messages, backup freshness, and restore drills.

# 9. DEV WORKFLOW NOTES

## How the existing specs/plans were produced

The implementation followed the Superpowers sequence:

1. **Brainstorm/spec:** clarify actors, scope, security boundaries, offline guarantees, and acceptance criteria before editing code.
2. **Written plan:** break the approved design into small tasks with exact files, tests, commands, and checkpoints.
3. **TDD:** add the smallest failing node:test case, confirm the intended failure, implement the minimum behavior, then rerun the focused test.
4. **Incremental verification:** run related tests after each slice, then the complete suite/build/diff/database checks at the end.
5. **Manual acceptance:** treat automated green as necessary but not sufficient for GPS, Android, print, and cross-role workflows.

The owner prefers plan-first work for substantial phases. A review or plan is not permission to implement; get approval before starting a new major slice. Stay within the approved phase and preserve unrelated working-tree changes. Claude Code can deviate from the exact Superpowers document format, but it should preserve the approval boundary, test-first behavior for business/security logic, and final evidence-based verification.

## Windows and Node gotchas

- This is a Windows PowerShell workspace. Use npm.cmd rather than npm when command resolution is inconsistent.
- The verified local runtime was Node v24.14.0/npm 11.9.0. node:sqlite emits an ExperimentalWarning. Use a Node version that actually includes DatabaseSync; an arbitrary older LTS will fail before tests start.
- The current repository dependency install is broken as described above. Repair with npm ci before debugging application code.
- The C: drive was nearly full. Gradle, Android SDKs, npm caches, node_modules, and dist can consume several gigabytes. Do not start another relocation/copy without checking free space and the exact target.
- The repository is in a OneDrive-backed path. File operations and large dependency scans can be slow; avoid placing Android build output in a synchronizing folder if a local build volume is available.

## npm run dev

- It starts Express on 8787 and Vite on 5173 through concurrently.
- Vite proxies relative /api requests to 127.0.0.1:8787.
- The API command is plain node server/index.mjs. It intentionally has no watcher because watching server/data SQLite WAL files caused restart loops. Source changes also do not hot-reload; restart the API process manually.
- The server does not load .env automatically.
- Importing server/db.mjs creates directories, opens the fixed SQLite file, runs ensure statements/seeding, and creates a daily local backup as a startup side effect.
- If dist already exists, the API also serves it. In Vite development use 5173 to avoid confusing an old dist bundle with current source.
- The committed API is loopback-only. A phone cannot use the Vite proxy or 127.0.0.1 on the PC.

## npm run mobile:sync

- It always runs a full TypeScript/Vite production build first, then Capacitor sync.
- VITE_API_ORIGIN must be set **before** the build. It is not a runtime preference inside the APK.
- Capacitor copies dist into generated Android assets. Do not hand-edit copied web files under android; edit src/public and sync again.
- Review native customizations after Capacitor upgrades/sync. The debug-only manifest and any signing/network configuration must remain scoped to the correct build type.
- Gradle may download tooling/dependencies even when the SDK is installed. JDK 21 and an Android SDK are required for the present Capacitor 8 project.
- mobile:sync proves web/native synchronization, not that Gradle assembles, signs, installs, or launches an APK.

## Tests and verification

- npm test is Node's built-in test runner over test/*.test.mjs. There are no intentionally skipped or todo tests.
- Many tests instantiate in-memory SQLite or call pure helpers. They do not exercise the live server/data/seizer.db or a real HTTP server.
- Treat these green tests as component-level evidence, not production acceptance: MSG91 uses fake fetch; IndexedDB uses fake-indexeddb; packaging reads files; service-worker policy is a pure function; the shared workflow state machine is not the runtime state machine.
- A complete handoff should run: npm test, npm run build, git diff --check, npm run db:backup, SQLite integrity/migration/trigger inspection, a real browser finance/agent flow, Gradle assemble, physical-device install, and cross-role mobile-to-finance acceptance.
- The database backup command writes another local SQLite file; it does not verify off-host recovery.
- Do not call the work complete merely because the existing unit suite passes. Production readiness specifically requires replacing the stubbed database/storage/verification paths and proving the live external services.
