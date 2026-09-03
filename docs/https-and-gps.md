# HTTPS and field GPS

The field app captures the agent's GPS location during vehicle verification. Phone
browsers only expose geolocation on a **secure origin** — `https://…` or `localhost`.
On a plain-http LAN address (e.g. `http://192.168.31.208:8787`) the browser blocks the
location request, which is why "GPS not capturing" happens during LAN testing. The app
now detects this and tells the agent to open the app over HTTPS instead of failing silently.

## Production — nothing extra to do

In production the app is served over real HTTPS (a proper certificate on your domain),
so it is already a secure context and GPS works with no special steps. Just make sure:

- The site is reached over `https://your-domain`.
- `PUBLIC_WEB_URL` is set to that same `https://your-domain` (used for release-pass verify links).

## Dev phone testing — pick one HTTPS option

The API server serves the built app on `http://localhost:8787`. To test GPS on a real
phone during development, put HTTPS in front of it with one of these:

### Option A — Cloudflare quick tunnel (easiest, no account)

```bash
cloudflared tunnel --url http://localhost:8787
```

It prints a public `https://<random>.trycloudflare.com` URL. Open that on the phone and
GPS works. Set `PUBLIC_WEB_URL` to the printed URL so verify links match.

### Option B — ngrok

```bash
ngrok http 8787
```

Open the printed `https://…ngrok…` URL on the phone.

### Option C — self-signed HTTPS on the LAN (works fully offline)

Generate a dev certificate once and run a TLS proxy in front of the API (for example with
`local-ssl-proxy` or `caddy`). Open `https://<your-lan-ip>` on the phone and accept the
one-time certificate warning; the origin is then treated as secure and GPS works. Use this
when there is no internet on the test network.

## Notes

- CORS on the API is open, so the app works through any of these origins without extra config.
- `captureLocation` is unchanged in behavior; only the error messaging was improved to name
  the secure-context requirement, denied permission, and timeout cases.
