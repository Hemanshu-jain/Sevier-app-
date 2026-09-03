# Group test with friends (free, temporary)

Run the app on your PC and expose it over HTTPS with a free Cloudflare quick tunnel so
friends can use it as agents on their phones while you act as the financer. No hosting
account, no card, no MSG91. Your PC must stay on during the test; the URL is fresh each run.

## One-time setup

1. Make sure MySQL is running locally (the same DB you develop against).
2. Install `cloudflared` (one time). On Windows, in PowerShell:
   ```
   winget install --id Cloudflare.cloudflared
   ```
   (Or download `cloudflared.exe` from Cloudflare and put it on your PATH.)

## Each test session

Open **two** terminals in the project folder.

**Terminal 1 — build and serve the app (with your local MySQL, test OTP):**
```
npm run serve:test
```
Wait for `Handoff API listening on http://0.0.0.0:8787`.

**Terminal 2 — open the free HTTPS tunnel:**
```
npm run tunnel
```
It prints a URL like `https://something-random.trycloudflare.com`. **That is the link you share.**

## Who logs in how

Everyone signs in with the fixed test OTP code **`123456`** (no real SMS is sent).

- **You (financer):** open the link on your laptop → sign in with a seeded finance user:
  | Name | Mobile | Role |
  |---|---|---|
  | Arun Mehta | `9845011111` | Super admin |
  | Divya Rao | `9845011112` | Manager |
  | Nisha Verma | `9845011113` | Staff |
- **Friends (agents):** open the link on their phone → **"New field agent? Create an account"** →
  enter their mobile → code `123456` → finish the short onboarding. Then **Add to Home Screen**
  so it behaves like an app.

## Connecting a friend to your workspace

A friend who self-registers becomes a **global agent** — they don't appear on your roster
automatically. To use them:

1. As financer, go to **Seizure agents → Add agent → Explore directory**.
2. Search their name/mobile and **add** them to your roster.
3. Open a case → assign it to them (you can assign several agents to one case).

They'll get the assignment as a notification and can start the field flow. GPS works because
the tunnel is HTTPS.

## Notes

- Data and uploaded photos persist in your local MySQL / `server/uploads` between sessions.
- The tunnel URL changes every time you run `npm run tunnel` — re-share it when you restart.
- Rate limiting is off in this local/test mode (it's a production-only protection), so a whole
  group sharing your one tunnel IP won't get throttled.
- This is for testing only. For an always-on public app, see the go-live steps (paid Node host
  or similar, real HTTPS domain, object storage for files, and MSG91 for real OTP SMS).
