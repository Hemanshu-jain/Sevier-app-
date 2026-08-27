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

## Local demo accounts

All seeded accounts use the password `demo123`.

- Finance super-admin: `admin@aaryafinance.test`
- Finance manager: `manager@aaryafinance.test`
- Field agent: `ravi@field.test`

## Current scope

- Finance-company browser dashboard
- Agent-only Android/mobile interface after field-agent sign-in
- Local SQLite database, seeded tenants, and JWT-backed sign-in
- Tenant-scoped API and role checks for finance and agent actions
- Monthly recovery register and direct agent assignment
- Failed-attempt reasons and custom notes submitted by agents
- Digital custody-certificate records using the parking/condition-slip checklist
- GPS-tagged photo/video evidence uploaded by agents and secured by case/tenant access rules
- Finance review drawer for field evidence, GPS metadata, inspection checks, and payment confirmation
- Immutable release-pass ledger with one-time verification codes and a printable customer handover pass
- Audit events and in-app notifications persisted by the API

## Next implementation slices

1. Excel import and loan-system API adapter
2. Native Android packaging, offline submission queue, and push notifications
3. Signed QR/PDF release passes plus a controlled yard-verification view
4. Production deployment, encrypted secrets, rate limiting, retention policies, and legal/compliance configuration
