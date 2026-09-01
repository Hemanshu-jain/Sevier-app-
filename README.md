# Handoff — Recovery Operations

Working local application for a multi-financer vehicle-recovery operations product.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The Vite client proxies its API requests to the local API on port `8787`.

For a production-style local run:

```bash
npm run build
npm start
```

Open `http://127.0.0.1:8787`.

## Field-agent PWA and Android project

Field agents use the same application after OTP sign-in. The role gate opens the mobile interface, which stores the last assigned workspace, drafts, evidence files, and unsent field operations in the device's IndexedDB. Pending operations synchronize one at a time while the app is open and online.

Install the browser version from Chrome's **Install app** action. To refresh the generated Android project:

```bash
npm run mobile:sync
```

`android/` is ready to open with `npm run mobile:open`. Compiling an APK requires Android Studio 2025.2.1 or later and an installed Android SDK. The generated project targets Android API 24 and later.

Browser development uses Vite's local `/api` proxy. For an Android build, set `VITE_API_ORIGIN` to the reachable HTTPS finance API origin before `npm run mobile:sync`; no server token, database credential, or production URL is embedded by default.

## Local demo accounts

Sign in with a registered mobile number. Development displays the local OTP (`123456` by default) after requesting it.

- Finance owner: `+91 98450 11111`
- Finance manager: `+91 98450 11112`
- Finance staff: `+91 98450 11113`
- Android field agent: `+91 98451 22014`

## Current scope

- Finance-company browser dashboard
- Agent-only Android/mobile interface after field-agent sign-in
- Local durable SQLite runtime plus a production PostgreSQL schema
- MSG91-ready OTP authentication, hashed revocable sessions, and tenant-scoped permissions
- CSV/XLSX monthly imports with immutable snapshots and duplicate-file protection
- Manual account correction before authority approval
- Finance-team and independent-agent access management
- Signed authority review before direct agent assignment
- Failed-attempt reasons and custom notes submitted by agents
- Digital custody-certificate records using the parking/condition-slip checklist
- GPS-tagged photo/video evidence uploaded by agents and secured by case/tenant access rules
- Finance review drawer for field evidence, GPS metadata, inspection checks, and payment confirmation
- Atomic custody and release writes, with database-enforced immutable audit and release-pass ledgers
- One-time release verification codes and a printable customer handover pass
- Tenant CSV reports, audit history, and in-app notifications persisted by the API
- Installable PWA shell that never caches authenticated API or evidence responses
- Durable per-agent IndexedDB drafts, evidence blobs, and idempotent foreground synchronization
- Capacitor 8 Android project with Handoff launcher assets and location permissions
- Keyboard navigation, visible focus states, modal focus handling, and permission-aware controls

## Next implementation slices

1. Production PostgreSQL/object-storage deployment, HTTPS API hosting, and MSG91 credentials
2. Push-notification provider integration
3. Signed QR/PDF release passes plus a controlled yard-verification view
