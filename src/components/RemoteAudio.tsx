import { useEffect, useRef, useState } from 'react';
import { Volume2, Play } from 'lucide-react';

interface Props {
  stream: MediaStream | null;
  disabled?: boolean;
}

/**
 * Attaches the WebRTC remote track to an audio element and handles the browser
 * autoplay policy: if playback is blocked, the user gets an explicit unlock button.
 */
export function RemoteAudio({ stream, disabled }: Props) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    setBlocked(false);
    if (!stream) return;
    el.play().catch(() => setBlocked(true));
  }, [stream]);

  const unlock = () => {
    const el = ref.current;
    if (!el) return;
    el.play()
      .then(() => setBlocked(false))
      .catch(() => setBlocked(true));
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <audio ref={ref} autoPlay playsInline controls />
      {blocked ? (
        <button className="btn block" onClick={unlock} disabled={disabled}>
          <Play size={15} /> Browser blocked autoplay - tap to hear the remote speaker
        </button>
      ) : (
        <div className="row tight faint">
          <Volume2 size={14} /> Remote audio is playing through this device.
        </div>
      )}
    </div>
  );
}
