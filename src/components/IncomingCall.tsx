import { Phone, PhoneIncoming, PhoneOff, PhoneOutgoing, UserRound } from 'lucide-react';

interface Props {
  phase: 'incoming' | 'outgoing';
  peerId: string | null;
  peerName: string | null;
  onAccept: () => void;
  onReject: () => void;
}

export function IncomingCall({ phase, peerId, peerName, onAccept, onReject }: Props) {
  const incoming = phase === 'incoming';
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={incoming ? 'Incoming call' : 'Outgoing call'}>
      <div className="modal">
        <div className="ring">
          {incoming ? <PhoneIncoming size={30} color="#5eb2ff" /> : <PhoneOutgoing size={30} color="#5eb2ff" />}
        </div>
        <div className="row tight" style={{ justifyContent: 'center', gap: 10 }}>
          <span className="avatar sm">
            <UserRound size={17} />
          </span>
          <div style={{ textAlign: 'left' }}>
            <div className="peer-name">{peerName || 'Unknown caller'}</div>
            <div className="peer-id">{peerId}</div>
          </div>
        </div>

        <h2 style={{ margin: '16px 0 4px', fontSize: 19 }}>{incoming ? 'Incoming voice call' : 'Calling...'}</h2>
        <p className="faint" style={{ margin: '0 0 20px' }}>
          {incoming
            ? 'Accepting routes your microphone through the ClearVoice noise suppressor before WebRTC sends it.'
            : 'Waiting for the remote user to accept. Audio starts after the answer is received.'}
        </p>

        <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
          {incoming ? (
            <>
              <button className="btn success lg" onClick={onAccept} autoFocus>
                <Phone size={17} /> Accept
              </button>
              <button className="btn danger lg" onClick={onReject}>
                <PhoneOff size={17} /> Reject
              </button>
            </>
          ) : (
            <button className="btn danger lg" onClick={onReject}>
              <PhoneOff size={17} /> Cancel call
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
