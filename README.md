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
- Immutable release-pass ledger with one-time verification codes and a printable customer handover pass
- Tenant CSV reports, audit history, and in-app notifications persisted by the API

## Next implementation slices

1. Desktop visual acceptance and accessibility pass
2. Production PostgreSQL/object-storage deployment and MSG91 credentials
3. Native Android packaging, offline submission queue, and push notifications
4. Signed QR/PDF release passes plus a controlled yard-verification view
