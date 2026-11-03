import { AudioEngineError } from '../types/audio';

export interface MicrophoneConstraints {
  /** Keep the browser pipeline from double-processing our DSP module. */
  disableBrowserNoiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  deviceId?: string;
}

export const DEFAULT_MIC_CONSTRAINTS: MicrophoneConstraints = {
  disableBrowserNoiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};

/**
 * `audioWorklet` is an accessor inherited from BaseAudioContext, so reading it off the
 * constructor's prototype invokes the getter with the wrong receiver and throws
 * "Illegal invocation". Presence has to be detected from the property descriptor instead.
 */
function declaresAudioWorklet(ctor: typeof AudioContext): boolean {
  let proto: object | null = ctor.prototype;
  while (proto) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'audioWorklet');
    if (descriptor && typeof descriptor.get === 'function') return true;
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}

/** Runtime capability probe so unsupported browsers get a clear message instead of silence. */
export function checkSupport(): { ok: boolean; code?: string; message?: string } {
  if (typeof window === 'undefined') return { ok: false, code: 'unknown', message: 'No window object.' };
  if (!window.isSecureContext) {
    return {
      ok: false,
      code: 'insecure-context',
      message: 'Microphone capture needs HTTPS or localhost. Open the app over a secure origin.',
    };
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { ok: false, code: 'no-microphone', message: 'This browser does not expose getUserMedia().' };
  }
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return { ok: false, code: 'audio-context-failed', message: 'Web Audio API is unavailable.' };
  if (!declaresAudioWorklet(Ctor)) {
    return {
      ok: false,
      code: 'worklet-unsupported',
      message: 'AudioWorklet is not supported here. Use a recent Chrome, Edge, Firefox or Safari build.',
    };
  }
  return { ok: true };
}

function toError(err: unknown): AudioEngineError {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new AudioEngineError(
        'permission-denied',
        'Microphone permission was denied. Allow it in the browser address bar and press Start again.',
      );
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new AudioEngineError('no-microphone', 'No microphone was found. Connect an input device and retry.');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new AudioEngineError(
        'device-in-use',
        'The microphone is busy or unreadable. Close other applications using it and retry.',
      );
    case 'OverconstrainedError':
      return new AudioEngineError(
        'no-microphone',
        'No microphone matches the requested constraints. Try without a specific device selected.',
      );
    default:
      return new AudioEngineError('unknown', err instanceof Error ? err.message : 'Unknown microphone error.');
  }
}

/** Stage 1: live capture. Never falls back to prerecorded audio. */
export async function openMicrophone(constraints: MicrophoneConstraints = DEFAULT_MIC_CONSTRAINTS): Promise<MediaStream> {
  const support = checkSupport();
  if (!support.ok) throw new AudioEngineError((support.code as never) || 'unknown', support.message || 'Unsupported browser.');

  const audio: MediaTrackConstraints = {
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48000 },
    echoCancellation: constraints.echoCancellation,
    noiseSuppression: constraints.disableBrowserNoiseSuppression ? false : true,
    autoGainControl: constraints.autoGainControl,
  };
  if (constraints.deviceId) audio.deviceId = { exact: constraints.deviceId };

  try {
    return await navigator.mediaDevices.getUserMedia({ audio, video: false });
  } catch (err) {
    if (constraints.deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: undefined }, video: false });
      } catch (fallbackErr) {
        throw toError(fallbackErr);
      }
    }
    throw toError(err);
  }
}

export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}

export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}
