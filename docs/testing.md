# Verification and measured results

Every number on this page is an output of a command that was actually run. Nothing here is
estimated, interpolated or "expected". Where a measurement could not be taken, that is stated in
[section 6](#6-what-has-not-been-measured) instead of being papered over.

Measured on **2026-11-03** on Windows 10.0.26300 (x64), Node **v24.20.0**, npm 10, Chromium-based
browser, Vite dev server on 5173, signaling server on 3001. No TURN server configured (`turn
configured: false`), STUN `stun:stun.l.google.com:19302`.

---

## 1. Reproduce

```powershell
# one-shot: headless DSP + real-server signaling
cd C:\path\to\clearvoice
npm test

# individually
npm run test:dsp
npm run test:signaling

# type safety and production bundle
npm run typecheck
npm run build

# in-browser DSP + WebRTC harness
npm run dev
# then open http://localhost:5173/tools/browser-check.html and press "Run checks"
```

`tools/` is a development harness directory. It is never imported by the app and never reaches the
bundle.

## 2. Suite A - headless DSP (`tools/dsp-selftest.mjs`)

Loads the **real** `src/worklets/noise-suppressor-worklet.js` source into a stub
`AudioWorkletProcessor` and feeds it 128-sample blocks, exactly as the browser's audio thread
would. No re-implementation, no approximation of the algorithm.

### A.1 Reconstruction correctness (FFT + sqrt-Hann WOLA)

Bypass mode must return the input, delayed and otherwise untouched.

| Measured | Value |
| --- | --- |
| Best-fit delay | 511 samples = 10.65 ms |
| Reported algorithmic latency | 10.67 ms (`N/fs`) |
| Correlation vs DC-blocked input | **0.99935** |
| Residual level vs input | **−34.7 dB** |
| Result | **PASS** (gate: correlation > 0.995) |

Why the reference is "input after the processor's own DC blocker": the blocker is part of the
processor, so comparing against the raw probe would measure the high-pass instead of the
transform/overlap-add path. The 511-sample delay is primer (256) + frame lookahead (256) + FIFO
rounding.

### A.2 Suppression per noise condition

Speech at −20 dBFS RMS; the noise sum scaled to a **designed** 5 dB broadband input SNR; −92 dBFS
microphone self-noise always present. "in/out SNR" is the harness's reference-free estimate: 20 ms
frame RMS, floor at the 10th percentile, activity gate at floor + 6 dB, ratio of active-frame to
inactive-frame RMS.

| Condition | in SNR (dB) | out SNR (dB) | gain (dB) | speech kept (dB) |
| --- | --- | --- | --- | --- |
| clean speech | 76.9 | 84.5 | +7.5 | −4.1 |
| speech + wind | 10.2 | 16.0 | +5.7 | −6.5 |
| speech + engine | 10.9 | 14.4 | +3.5 | −6.8 |
| speech + traffic | 14.9 | 21.5 | +6.6 | −4.5 |
| speech + horn | 77.5 | 86.6 | +9.2 | −2.7 |
| speech + wind + engine + traffic + horn | 11.1 | 17.8 | +6.7 | −5.2 |

Acceptance gates (all met): at least 3 dB of floor reduction on a noisy mixture, no more than 3 dB
of floor *increase* on clean speech, speech-band loss under 8 dB, no non-finite samples.

How to read this table honestly:

- The designed SNR is broadband (full 0-24 kHz), the estimate is frame-RMS based, so wind shows an
  in-SNR of 10.2 dB rather than 5.0 dB: most wind energy sits under 260 Hz and the estimator's
  frames average the whole band. The **gain** column, not the absolute column, is the comparison.
- The horn row reads 77.5 dB in because the synthetic horn is a 0.45 s burst every 3 s; 85 % of the
  frames are gap frames, so the tracked floor is the −92 dBFS self-noise. This is a limitation of
  any reference-free floor-based SNR against intermittent noise - the row proves the tracker is not
  fooled into raising the floor on a horn onset, which is the behaviour worth testing, but its
  absolute SNR is not a 5 dB condition. Sustained noise (wind, engine, traffic) is the meaningful
  SNR comparison.
- "speech kept" is the speech-band level shift. −2.7 to −6.8 dB of absorption is the known price of
  magnitude-only subtraction; it is the parameter trade-off the strength slider exists for.

### A.3 Real-time behaviour (combined mixture, 6 s)

| Measured | Value |
| --- | --- |
| Frames processed | 1116 |
| Input noise floor | −23.0 dBFS |
| Output noise floor | −35.1 dBFS |
| **Suppression** | **12.1 dB** |
| Compute per 5.33 ms hop | 0.030 ms |
| Audio-thread load | 0.6 % |
| Samples hitting the limiter | 0 |
| Real-time capable | **PASS** |

The mixtures contain random components (the self-noise and the noise generators call
`Math.random()` without a fixed seed), so re-running moves the dB columns by roughly ±1 dB - the
table quotes one complete run. The reconstruction check in A.1 is the deterministic one: its
correlation only depends on the transform path.

## 3. Suite B - signaling (`tools/signaling-test.mjs`)

Starts the actual `server/index.js` on port 3123, waits for `/health`, then drives seven real
Socket.IO clients. Latest run: **27 passed, 0 failed**.

| Group | Assertions (all PASS) |
| --- | --- |
| HTTP surface | `/health` reports the service; `/config/ice` never exposes TURN credentials |
| Registration | unique short ids; ICE config returned; directory lists online users; a taken id is refused; a reload does not leave the abandoned id in the directory |
| Call setup | callee receives the incoming call; self-call refused (`self-call`); offline id refused (`offline`); outsider cannot answer (`forbidden`); unknown call id refused (`no-call`) |
| SDP / ICE relay | accepted reaches the caller; offer arrives intact; ICE candidate relayed; end-of-candidates passes through as `null`; malformed candidate rejected (`bad-payload`); non-participant cannot inject an offer (`forbidden`); signaling aimed at a third id refused (`forbidden`); 20 001-character SDP rejected (`bad-payload`); answer returns to the caller |
| Teardown | hangup ends the call for both sides; post-teardown outsider cannot hang up (`no-call`) |
| Recovery / abuse | a dropped peer notifies the other side (`cv:peer-lost`); a flooding client is cut off (`rate-limited`) |
| Wire discipline | only allow-listed `cv:*` events observed on 218 exchanged messages; **largest frame 243 bytes** |

The last group is the direct evidence for "never transmit audio through Socket.IO": the largest
frame on the wire is a fraction of a kilobyte, and an Opus-encoded second of audio is roughly
16 KB.

A defect was found and fixed by this suite: re-registering after a page reload kept the previous
user id mapped to the same socket, so signaling addressed to the abandoned id still landed on the
live connection. `server/socket/callHandlers.js` now releases the old identity first, and the
assertion above locks that behaviour in.

## 4. Suite C - in-browser harness (`tools/browser-check.html`)

Runs the **shipped** worklet asset (`NoiseSuppressor.ts` + `?url`) inside a real browser. Checks 1
and 2 use an `OfflineAudioContext`, so they need no microphone permission and no user gesture; 3
and 4 use a live `AudioContext` fed by an oscillator through the worklet, then two genuine
`RTCPeerConnection`s. Latest run (hidden tab, `user activation for live checks: false`):

```
[1] the shipped worklet loads and runs in a real AudioWorklet
PASS  bypass reconstruction in-browser - correlation 1.00000 at lag 511, residual -141.5 dB

[2] suppression measured by the browser audio thread
PASS  noise energy reduced by the worklet - -5.4 dB overall, reported floor -26.0 -> -37.5 dBFS
PASS  statistics reached the main thread - 747 frames, 10.67 ms algorithm delay

[3] processed track is attachable to an RTCPeerConnection
      live audio context: running
PASS  offer carries the processed audio m-line - SDP built from the suppressed track
PASS  peer connections established over ICE - A=connected, B=connected

[4] audio really crosses the connection
      sender  rms 0.36981 (track live)
      receiver rms 0.00000 (track live, enabled true)
      inbound 426 packets, 34221 bytes, jitter 1.00 ms, discarded 400, audio energy 0
      selected pair succeeded, rtt 4.00 ms
SKIP  remote audio playout - the harness tab is hidden and Chrome discarded 400 of 426 packets;
      the transport itself delivered audio (rtt 4.0 ms). Re-run in a visible tab to see the
      receiver level.
```

What that establishes:

- the algorithm runs on the browser's audio thread (not the harness's JS loop) at full real-time
  speed, and its statistics reach the main thread;
- the processed track produces a valid SDP with an audio m-line and completes ICE;
- 426 RTP packets / 34 221 bytes crossed the connection with 1.00 ms jitter and 4.00 ms RTT;
- the receiver showed silence **because the harness tab was hidden** - Chrome discarded 400 of 426
  inbound packets and reported `totalAudioEnergy` 0. This is a receiver-playback policy of the
  browser, not a media failure, and it is the one thing in this suite that must be re-run in a
  visible tab to be closed out.

## 5. Application-level verification in a browser

Against the live dev server and a command-line signaling peer (`tools/mock-peer.mjs`), identity
`Operator / D531` in the browser:

| Check | Evidence | Result |
| --- | --- | --- |
| App boots in a real browser | all five tabs render; canvases sized 386×165, 386×237, 689×212; zero error notices | PASS (after fixing an `audioWorklet` capability probe that threw `Illegal invocation` and blank-screened the app) |
| Signaling connect | header `ID D531`, pill `Signaling online` | PASS |
| Incoming call UI | CLI peer dials D531 → modal `Incoming voice call` with Accept/Reject, caller name and id; directory row flips to `In call` | PASS |
| Accept without suppression | DOM dispatch on Accept → modal closes, error notice reads exactly `Start noise processing before accepting a call.`; no raw-microphone fallback | PASS |
| Caller is notified | peer log: `call b27e8758-… ended (rejected)` and both directory rows return to online | PASS |
| Reject path | peer log: `call 86467555-… ended (rejected)` | PASS |

Two fixes came out of this pass:

- `src/audio/AudioCapture.ts` - `AudioContext.prototype.audioWorklet` is an accessor inherited from
  `BaseAudioContext`, so the old `!Ctor.prototype.audioWorklet` probe threw and the whole app
  rendered nothing. Feature detection now walks the prototype chain with
  `Object.getOwnPropertyDescriptor`.
- `src/services/socketService.ts` + `src/services/callController.ts` / `src/pages/Calling.tsx` -
  the dev build had no `VITE_SIGNALING_URL` and connected to the Vite origin (:5173), and the
  no-audio acceptance path wrote its clear message into `failure` and then `teardown()` blanked it,
  leaving only the internal code `no-audio` on screen. The dev client now defaults to the
  `:3001` endpoint, and the human-readable message survives to the UI.

Build and bundle:

```
tsc --noEmit  → no errors
vite build    → 1628 modules, 1.55 s
dist/assets/index-kThno3ZB.js              277.80 kB │ gzip  83.87 kB
dist/assets/noise-suppressor-worklet-…js    16.75 kB
dist/assets/index-eO_4Ht9U.css              10.54 kB │ gzip   3.03 kB
```

## 6. What has NOT been measured

These are open items, not results. They require a person with a real microphone and a real
environment, which the verification machine used here does not have (the automated browser session
denies `getUserMedia` and its tab is hidden):

1. **Live microphone capture and the audible two-device call.** The processed→RTP path is proven by
   the oscillator-fed harness (section 4) and the signaling/UI path by section 5, but no measurement
   exists yet of a real voice through the real pipeline between two real devices.
2. **Remote playout in a visible tab** - see the SKIP in section 4.
3. **Real wind / traffic / engine / horn noise.** Section A.2 uses synthetic, reproducible
   generators scaled to a designed SNR. They are models of those noises, not recordings.
4. **PESQ and STOI.** The specification allows them only when reference audio and the tooling exist.
   Neither is installed here, so the app computes reference-free proxies and exports WAV of the
   original and enhanced channels for external scoring.
5. **CPU of the whole application** (only the audio-thread share is measured), behaviour with TURN
   configured, packet loss and jitter under a real degraded network, and iOS Safari.
6. **Long-call stability** (no soak test beyond the harnesses' own durations).

Checklist for the person running the final acceptance test:

```powershell
# device 1 and device 2 (or two browser profiles), same network
cd C:\path\to\clearvoice\server ; npm start
cd C:\path\to\clearvoice        ; npm run dev
```

- [ ] both devices show `Signaling online` and each other in the directory
- [ ] Start processing → meters and spectra move with speech
- [ ] dial → callee sees the incoming screen → accept → both see `active`, duration ticks
- [ ] talk on device 1, hear the suppressed voice on device 2 (keep both tabs visible)
- [ ] mute, hang up, and confirm the call returns to idle on both sides
- [ ] make noise (engine/fan/traffic) and read the noise-floor and suppression metrics on the
      Audio processing tab; capture rows on the Evaluation tab and export them
- [ ] pull the network cable / walk out of Wi-Fi range and observe the ICE restart message and
      recovery or a clean failure
