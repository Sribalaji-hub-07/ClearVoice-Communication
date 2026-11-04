# ClearVoice

**Real-Time Adaptive Noise Suppression for Enhanced IP Voice Communication**

ClearVoice cleans a microphone signal on the fly so that a call placed from a noisy place - a
motorcycle in traffic, for example - carries the rider's voice instead of wind, engine, tyre and
horn noise. Suppression runs entirely inside the browser on the audio thread as an
`AudioWorklet` implementing short-time Fourier transform (STFT) adaptive spectral subtraction.
The *processed* track, never the raw microphone, is what WebRTC puts on the wire. A Node.js
Socket.IO server only sets the call up; it never sees a sample of audio.

---

## Table of contents

- [What it does](#what-it-does)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Run it locally (Windows PowerShell)](#run-it-locally-windows-powershell)
- [Configuration](#configuration)
- [Verification and tests](#verification-and-tests)
- [Documentation](#documentation)
- [Deployment](#deployment)
- [Security posture](#security-posture)
- [Known limitations](#known-limitations)

---

## What it does

| Area | Behaviour |
| --- | --- |
| Capture | `getUserMedia` is requested only after you press **Start processing**; mono, 48 kHz, echo cancellation and auto-gain disabled so the algorithm owns the signal. |
| Suppression | 7-stage pipeline: DC block → 512-sample framing at 256-hop → FFT → biased-minima noise estimation → VAD → adaptive spectral subtraction → inverse FFT with weighted overlap-add. Output is limited, never clipped. |
| Controls | One **Reduction strength** slider (0-100) plus over-subtraction, spectral floor, noise smoothing, speech preservation, attack/release and VAD sensitivity. Changes apply live through the worklet's parameter channel. |
| Measurement | Original and enhanced level meters, waveforms and overlaid spectra, VAD indicator, noise floor in/out, mean speech-band gain, algorithmic latency, per-frame compute time and audio-thread CPU - all read from the running processor, nothing simulated. |
| Calling | Register → unique short ID, online directory, dial / incoming / accept / reject / hang up / mute, call duration from the real connect timestamp, connection and ICE state, live network metrics, automatic teardown and recovery messages. |
| A/B | Monitor switch (off by default), paired original/enhanced recording to `.webm`, and before/after playback of the same moment. |
| Evaluation | Two-second aligned original/enhanced snapshots per noise condition, reference-free SNR-in / SNR-out, noise-floor reduction, spectral flatness and speech-energy change in a results table you can export as CSV, plus WAV download of either channel for external PESQ/STOI tooling. |

## Tech stack

| Layer | Mandated | Used |
| --- | --- | --- |
| Frontend | React + TypeScript + Vite, HTML5/CSS3, Lucide React | yes, unchanged |
| Audio | Web Audio API, AudioWorklet, STFT, adaptive spectral subtraction, noise-spectrum estimation, VAD | yes, all in `src/worklets/noise-suppressor-worklet.js` |
| Transport | WebRTC for audio, Socket.IO for signaling only, STUN + configurable TURN | yes, one `RTCPeerConnection` per call |
| Backend | Node.js + Express + Socket.IO | `server/` |
| Hosting | Vercel (frontend) + Railway (backend), env-var configuration | see [docs/deployment.md](docs/deployment.md) |

No library was substituted. Two module boundaries were added beyond the classic
`components/` split, and they are documented in
[docs/architecture.md](docs/architecture.md#deviations-from-the-original-module-listing).

## Repository layout

```
clearvoice/
├── index.html                     Vite entry, mounts #root
├── src/
│   ├── main.tsx                   createRoot + StrictMode
│   ├── App.tsx                    tab shell, owns the three singletons
│   ├── audio/
│   │   ├── AudioCapture.ts        getUserMedia + capability probes
│   │   ├── AudioEngine.ts         the Web Audio graph, one instance per app
│   │   ├── NoiseSuppressor.ts     main-thread handle on the worklet
│   │   ├── evaluation.ts          reference-free metrics from aligned buffers
│   │   └── audioUtils.ts          dBFS/RMS, WAV encoding, formatting
│   ├── worklets/
│   │   └── noise-suppressor-worklet.js   the algorithm (self-contained)
│   ├── hooks/                     useAudioEngine / useSocket / useWebRTC
│   ├── services/                  socketService, sessionStore, callController,
│   │                              webrtcService, callHistory (module singletons)
│   ├── components/                meters, visualiser, controls, tables, modals
│   ├── pages/                     Home, Dashboard, Calling, Comparison, Evaluation
│   └── types/                     audio.ts, call.ts
├── server/
│   ├── index.js                   Express + Socket.IO bootstrap, /health, /config/ice
│   ├── socket/callHandlers.js     registration, directory, call state machine, relays
│   ├── config/iceServers.js       STUN/TURN from environment variables
│   └── .env.example
├── tools/                         dsp-selftest.mjs, signaling-test.mjs,
│                                  browser-check.html, mock-peer.mjs
├── render.yaml                    Render Blueprint (static site + signaling service)
└── docs/                          architecture.md, algorithm.md, testing.md, deployment.md
```

## Prerequisites

- **Node.js 18 or newer** (this project was built and measured on v24.20.0) and npm 10+.
- **Chrome, Edge, Firefox or Safari 14.3+**. AudioWorklet and WebRTC both have to exist, and the
  Web Audio graph only runs in a secure context - `http://localhost` counts as one.
- A microphone. Two devices (or one device plus a second browser profile) are needed to place a
  real call.

## Run it locally (Windows PowerShell)

Frontend and backend are separate processes, so use **two PowerShell windows**.

```powershell
# window 1 - signaling server (port 3001)
cd C:\path\to\clearvoice\server
npm install
npm start
```

```powershell
# window 2 - frontend (port 5173)
cd C:\path\to\clearvoice
npm install
npm run dev
```

Both have working defaults, so nothing else is required for a local run. To override them, set the
variables in the shell before starting - `server/.env.example` lists the names, but the backend has
no dotenv loader, so a `.env` file on its own is not read:

```powershell
$env:PORT = "3001"
$env:CORS_ORIGIN = "http://localhost:5173,http://127.0.0.1:5173"
npm start
```

For the frontend, copy `.env.example` to `.env.local` only when the signaling server is not on
port 3001 of the same host (Vite does read `.env.local`).

Open `http://localhost:5173`, press **Start processing**, allow the microphone, then open the same
URL in a second browser (or `http://<your-LAN-IP>:5173` from another device - Vite listens on all
interfaces) and dial the ID shown in the first one.

> A non-localhost client can only use its microphone over HTTPS, or after you mark the
> `http://<LAN-IP>` origin as a secure origin in the browser. The single-device loopback test does
> not have this restriction.

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR on 5173 |
| `npm run build` | `tsc --noEmit` then a production bundle in `dist/` |
| `npm run preview` | serve `dist/` locally |
| `npm run typecheck` | types only |
| `npm test` | both automated suites below |
| `npm run test:dsp` | headless run of the real worklet through Node |
| `npm run test:signaling` | spins up the server and drives it with real sockets |

## Configuration

Frontend - `.env.local` at the repository root (Vite only exposes `VITE_`-prefixed names):

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_SIGNALING_URL` | empty → same origin; in `npm run dev` the client falls back to `http://<host>:3001` | Socket.IO endpoint. Must be set for a deployed frontend. |

Backend - process environment. `server/.env.example` is the reference list of names; set them in
PowerShell, a start script, or Railway's Variables tab (no dotenv loader is wired in):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | listen port; Railway injects this |
| `CORS_ORIGIN` | `http://localhost:5173` | comma-separated allow-list for HTTP and sockets |
| `STUN_URL` | `stun:stun.l.google.com:19302` | first STUN server handed to clients |
| `STUN_URL_2` | empty | optional second STUN |
| `TURN_URL` | empty | relay, e.g. `turn:turn.example.com:3478?transport=udp` |
| `TURN_USERNAME` | empty | **environment only - never commit** |
| `TURN_CREDENTIAL` | empty | **environment only - never commit** |

TURN becomes active only when all three TURN variables are set; `/health` and `/config/ice`
report `turnConfigured` without ever echoing the secret.

## Verification and tests

Three independent layers, all described with their measured output in
[docs/testing.md](docs/testing.md):

1. `npm test` - the DSP harness loads the shipped worklet source and runs it in Node; the
   signaling harness boots the real server and drives seven clients through registration, call
   setup, relay, validation, teardown, disconnect and flooding.
2. `tools/browser-check.html` - a Vite-served dev page (not part of the product) that runs the
   shipped `?url` worklet asset inside a real browser: offline render for reconstruction and
   suppression, then two `RTCPeerConnection`s for SDP, ICE and `getStats()`.
3. Two devices on a real call with real noise, which only a person with a microphone can do.
   `tools/mock-peer.mjs` rings the browser from the command line so the calling UI can be
   exercised without a second device.

## Documentation

- [docs/architecture.md](docs/architecture.md) - system diagram, module map, signaling sequence,
  state machines, deviations from the original module listing.
- [docs/algorithm.md](docs/algorithm.md) - the 7-stage flowchart, the equations as implemented,
  every parameter with its range and default, and the design decisions (WOLA, musical noise,
  latency accounting).
- [docs/testing.md](docs/testing.md) - measured results, provenance and open items.
- [docs/deployment.md](docs/deployment.md) - Vercel and Railway step by step, including TURN.

## Deployment

Frontend → Vercel, backend → Railway, `VITE_SIGNALING_URL` and `CORS_ORIGIN` pointing at each
other, HTTPS on both. The full procedure with the exact dashboard fields is in
[docs/deployment.md](docs/deployment.md). **Render** is covered there in both shapes: one Web Service
at the repository root (`npm install && npm run build`, then `npm start` - the server also serves
`dist/`, so no `VITE_SIGNALING_URL` and no CORS setup), or the two-service layout declared by
`render.yaml` (static site from `dist/` plus a Node service rooted at `server/`).

## Security posture

- Audio path is peer-to-peer WebRTC (DTLS-SRTP). The Socket.IO server relays SDP, ICE and call
  control only; the signaling suite asserts on the wire that no message can carry audio
  (largest observed frame 243 bytes).
- TURN credentials live in environment variables, are never written to the bundle, and are masked
  by `/config/ice`.
- Every signaling payload is validated: ID pattern `^[A-Za-z0-9_-]{2,24}$`, name length, SDP size
  cap 20 000 characters, ICE candidate shape, plus per-socket rate limiting at 60 messages/second.
  Relay is authorised - only the two participants of a live call can send to each other.
- Microphone access requires a click and is reversible: **Stop** tears the graph down, stops every
  track and closes the `AudioContext`. Recording and local monitoring are explicit, opt-in
  actions, and recordings stay in the browser.
- Call history is kept in `localStorage` on the local machine only.

## Known limitations

- Reference-free metrics only. SNR and intelligibility proxies are estimated from the aligned
  original/enhanced buffers; PESQ and STOI need the reference speech plus external tooling, so the
  app exports WAV for that rather than pretending to compute them.
- Spectral subtraction leaves residual "muscle noise" in strongly non-stationary noise (horns,
  impacts). The median + attack/release stage reduces it; it does not remove it.
- TURN is optional by configuration, so two peers behind symmetric NATs cannot connect until you
  supply a relay.
- Verification of the audible end-to-end call, real environmental noise and browser microphone
  permission has to be done by a person with a real device; see docs/testing.md for what is and is
  not measured yet.
