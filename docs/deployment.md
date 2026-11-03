# Deployment

Frontend → **Vercel**, signaling backend → **Railway**, configuration through environment
variables only. No secret is committed.

| | Frontend | Backend |
| --- | --- | --- |
| Host | Vercel | Railway |
| Kind | static SPA built by Vite | Node.js process (`server/`) |
| Build | `npm run build` | install only (`npm ci`) |
| Output / start | `dist/` (no server needed) | `npm start` → `node index.js` |
| Root directory | repository root | `server` |
| Runtime | any recent Node for the build | Node ≥ 18 (built and measured on 24.x) |
| Required variables | `VITE_SIGNALING_URL` | `CORS_ORIGIN`, `PORT` (Railway injects), STUN/TURN optional |

---

## 1. Push the code

Commit `src/`, `server/`, `index.html`, `package.json`, `package-lock.json`,
`server/package.json`, `server/package-lock.json`, `tsconfig.json`, `vite.config.ts`,
`.env.example`, `server/.env.example`. `.gitignore` already excludes `dist/`, `node_modules/`,
`.env`, `.env.local` and `server/.env` - check that it stayed that way before the first push:

```powershell
cd C:\path\to\clearvoice
git init ; git add . ; git status --short      # confirm no .env and no credentials in the list
git commit -m "ClearVoice: adaptive noise suppression + WebRTC calling"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

## 2. Backend first (Railway)

The frontend's URL is baked into the bundle at build time, so the backend's address must exist
before you build the frontend.

1. New project → **Deploy from GitHub repo** → pick this repository.
2. If Railway detects the wrong service root, open the service → **Settings → Build** and set
   **Root Directory** to `server`.
3. **Variables**:

   | Key | Value |
   | --- | --- |
   | `CORS_ORIGIN` | the Vercel origin you will get in step 3, e.g. `https://clearvoice.vercel.app` (comma-separate several) |
   | `NODE_VERSION` | `24` (optional; pin what you tested with) |
   | `STUN_URL` | default `stun:stun.l.google.com:19302` if omitted |
   | `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` | only if you have a relay - see step 4 |

   Railway assigns `PORT` itself; do not set it.
4. **Settings → Networking**: generate a public domain (TCP, path `/`). Railway's HTTP proxy already
   serves TLS, so the backend is reachable as `https://<name>.up.railway.app`.
5. Deploy, then check it from PowerShell:

   ```powershell
   Invoke-RestMethod https://<railway-host>/health
   Invoke-RestMethod https://<railway-host>/config/ice
   ```

   Expected: `{ ok: true, service: "clearvoice-signaling", … }` and an ICE status whose
   `turnConfigured` flag matches your variables - with **no** credential text in either response.

> Call state (`users`, `calls`) is held in memory, which is what the specification asks for and is
> correct for one process. If you scale to several Railway instances, add a Socket.IO adapter
> (Redis) or route all clients to one instance; otherwise a caller and a callee on different
> instances cannot see each other. Do not turn on multiple replicas without that change.

## 3. Frontend (Vercel)

1. **Add New… → Project** → import the same repository.
2. Framework preset **Vite**, Build command `npm run build`, Output directory `dist`.
3. **Settings → Environment Variables** (production):

   | Key | Value |
   | --- | --- |
   | `VITE_SIGNALING_URL` | `https://<railway-host>` - scheme `https`, no trailing slash |

4. **Redeploy** so the variable is compiled in. Changing it in the dashboard without redeploying
   does nothing: `import.meta.env.VITE_*` is substituted at build time, not at runtime.
5. Copy the Vercel domain into Railway's `CORS_ORIGIN` if you have not already, and restart the
   Railway service so the new allow-list takes effect.
6. Only `VITE_`-prefixed variables ever reach the browser. Never put a TURN secret in one of them -
   the socket hands the client its ICE configuration, which is why the credential stays server-side.

## 4. TURN (optional, but required for symmetric NAT)

STUN alone works when at least one side can be reached directly or reflexively. Two peers behind
separate NATs - a phone on mobile data plus a laptop on campus Wi-Fi, the typical demonstration
case - need a relay.

Either run a relay on Railway as a second service (coturn), or use a managed provider
(Twilio Network Traversal, Xirsys, OpenRelay, …), then set on the backend:

```
TURN_URL=turn:your-relay.example:3478?transport=udp
TURN_USERNAME=<generated>
TURN_CREDENTIAL=<generated>
```

The server only advertises TURN when all three are present, clients receive it over their
authenticated socket, and `/config/ice` reports `turnConfigured: true` without echoing the
credential. The UI's `STUN only…` notice on the Voice calling tab disappears once they are set.

For the coturn-on-Railway route you must expose UDP 3478 and the relay port range as TCP/UDP routes,
which Railway's public networking only does for TCP - a raw-UDP relay is usually easier on a VPS
with a public IP. Budget for that before promising a symmetric-NAT demonstration.

## 5. Post-deployment checks

```powershell
Invoke-RestMethod https://<railway-host>/health          # ok:true
Invoke-RestMethod https://<railway-host>/config/ice      # turnConfigured as configured, no secrets
```

- Open the Vercel URL on two devices. The padlock must be real (Vercel and Railway both give HTTPS
  by default) - browsers only expose `getUserMedia` in a secure context, so an `http://` address
  will show the "insecure context" notice and no microphone prompt.
- Signaling must connect without a mixed-content warning. If you ever serve the frontend over HTTPS
  but point `VITE_SIGNALING_URL` at `http://…`, the socket will be blocked silently; the URL must be
  `https://` and the backend must sit behind TLS.
- Place a call, confirm both sides reach `active`, then read the metrics panel: jitter, RTT and
  packet loss come from `getStats()` and will be non-zero only when a real call exists.
- Check the ICE resolution field during a call: `host → srflx` is a direct/reflexive path, `→ relay`
  means TURN did its job.

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| UI shows `Signaling error` / retries forever | `VITE_SIGNALING_URL` wrong, missing, or baked in before the variable existed | set it, redeploy, hard-refresh |
| `403 / origin not allowed` on the socket | `CORS_ORIGIN` does not include the exact Vercel origin (scheme + host, no path) | add it, restart the service |
| Incoming call never rings | callee registered a different id, or the page was closed | read the id from the callee's header; keep the tab open |
| Call connects but no audio both ways, ICE `failed` | symmetric NAT with no TURN | configure TURN (step 4) |
| Audio one-way after network change | ICE restart attempted once and refused | hang up and re-dial; that is the designed behaviour, the UI says so |
| Microphone prompt does not appear | not a secure context, or permission blocked at OS/browser level | use the `https://` URL, reset site permissions |
| Railway service restarts and calls drop | in-memory state by design | re-dial; scale only with a Socket.IO adapter |
