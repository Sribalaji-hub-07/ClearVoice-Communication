import { useState, useEffect, useRef, useCallback } from 'react';
import { WebRTCCallManager } from '../services/webrtc';
import * as socketService from '../services/socket';
import type { CallState, CallInfo, CallStats, ConnectionQuality } from '../types/call';
import { generateCallId } from '../types/call';

export interface UseCallResult {
  callState: CallState;
  callInfo: CallInfo | null;
  callStats: CallStats | null;
  connectionQuality: ConnectionQuality;
  error: string | null;
  startCall: (receiverId: string, receiverName: string, stream: MediaStream) => void;
  acceptCall: (stream: MediaStream) => void;
  rejectCall: (reason?: string) => void;
  endCall: () => void;
  isMuted: boolean;
  toggleMute: () => void;
}

export function useCall(userId: string, userName: string): UseCallResult {
  const [callState, setCallState] = useState<CallState>('idle');
  const [callInfo, setCallInfo] = useState<CallInfo | null>(null);
  const [callStats, setCallStats] = useState<CallStats | null>(null);
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>('good');
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  // ── Refs mirror state so socket callbacks always see the latest values ──
  const callStateRef = useRef<CallState>('idle');
  const callInfoRef = useRef<CallInfo | null>(null);
  const callManagerRef = useRef<WebRTCCallManager | null>(null);

  const setCallStateWithRef = useCallback((s: CallState) => {
    callStateRef.current = s;
    setCallState(s);
  }, []);

  const setCallInfoWithRef = useCallback((info: CallInfo | null) => {
    callInfoRef.current = info;
    setCallInfo(info);
  }, []);

  const timeoutsRef = useRef<{
    outgoing?: ReturnType<typeof setTimeout>;
    ringing?: ReturnType<typeof setTimeout>;
    connecting?: ReturnType<typeof setTimeout>;
  }>({});

  const clearAllTimeouts = useCallback(() => {
    if (timeoutsRef.current.outgoing) clearTimeout(timeoutsRef.current.outgoing);
    if (timeoutsRef.current.ringing) clearTimeout(timeoutsRef.current.ringing);
    if (timeoutsRef.current.connecting) clearTimeout(timeoutsRef.current.connecting);
    timeoutsRef.current = {};
  }, []);

  const handleCleanup = useCallback((reason?: string) => {
    clearAllTimeouts();
    if (callManagerRef.current) {
      callManagerRef.current.cleanup();
      callManagerRef.current = null;
    }
    setCallStateWithRef('idle');
    setCallInfoWithRef(null);
    setCallStats(null);
    setIsMuted(false);
    if (reason) setError(reason);
  }, [clearAllTimeouts, setCallStateWithRef, setCallInfoWithRef]);

  // ── Socket event listeners — registered ONCE, use refs for latest state ──
  useEffect(() => {
    socketService.onIncomingCall((data) => {
      console.log('[CALL] onIncomingCall received:', data);
      if (callStateRef.current !== 'idle' && callStateRef.current !== 'ended') {
        console.log('[CALL] Currently busy in state:', callStateRef.current);
        socketService.emitCallRejected({ callId: data.callId, receiverId: userId, reason: 'busy' });
        return;
      }
      if (callStateRef.current === 'ended') {
        handleCleanup();
      }
      const info: CallInfo = {
        callId: data.callId,
        callerId: data.callerId,
        callerName: data.callerName,
        receiverId: userId,
        receiverName: userName,
        startedAt: Date.now(),
      };
      setCallInfoWithRef(info);
      setCallStateWithRef('ringing');
      setError(null);
      timeoutsRef.current.ringing = setTimeout(() => {
        handleCleanup('Missed call — no answer');
      }, 45000);
    });

    socketService.onCallAccepted(async (data) => {
      if (callStateRef.current !== 'calling') return;
      const info = callInfoRef.current;
      if (!info || info.callId !== data.callId) return;
      clearAllTimeouts();
      setCallStateWithRef('connecting');
      try {
        const pc = callManagerRef.current!;
        const offer = await pc.createOffer();
        socketService.emitOffer({
          callId: info.callId,
          fromUserId: userId,
          targetId: info.receiverId,
          offer,
        });
      } catch (err) {
        console.error('[CALL] Failed to create offer:', err);
        handleCleanup('Failed to establish connection');
      }
    });

    socketService.onCallRejected((data) => {
      const info = callInfoRef.current;
      if (!info || info.callId !== data.callId) return;
      handleCleanup(`Call declined`);
    });

    socketService.onOffer(async (data) => {
      const info = callInfoRef.current;
      if (!info || info.callId !== data.callId || !callManagerRef.current) return;
      try {
        const answer = await callManagerRef.current.handleOffer(data.offer);
        socketService.emitAnswer({
          callId: data.callId,
          fromUserId: userId,
          targetId: data.fromUserId,
          answer,
        });
      } catch (err) {
        console.error('[CALL] Failed to handle offer:', err);
        handleCleanup('WebRTC connection failed');
      }
    });

    socketService.onAnswer(async (data) => {
      const info = callInfoRef.current;
      if (!info || info.callId !== data.callId || !callManagerRef.current) return;
      try {
        await callManagerRef.current.handleAnswer(data.answer);
        // Clear connecting timeout once answer is processed
        clearAllTimeouts();
      } catch (err) {
        console.error('[CALL] Failed to handle answer:', err);
        handleCleanup('WebRTC connection failed');
      }
    });

    socketService.onIceCandidate(async (data) => {
      const info = callInfoRef.current;
      if (!info || info.callId !== data.callId || !callManagerRef.current) return;
      try {
        await callManagerRef.current.addIceCandidate(data.candidate);
      } catch (err) {
        console.error('[CALL] Failed to add ICE candidate:', err);
      }
    });

    socketService.onCallEnded((data) => {
      const info = callInfoRef.current;
      if (!info || info.callId !== data.callId) return;
      handleCleanup(data.reason === 'user-disconnected' ? 'Other party disconnected' : undefined);
    });

    socketService.onCallError((data) => {
      handleCleanup(data.message || 'Receiver is currently offline');
    });

    return () => {
      socketService.removeAllCallListeners();
    };
    // intentionally only runs once — refs keep values up-to-date
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, userName]);

  const initWebRTC = useCallback((stream: MediaStream, currentCallInfo: CallInfo) => {
    const cm = new WebRTCCallManager({
      onStateChange: (s) => {
        setCallStateWithRef(s);
        if (s === 'ended') {
          setTimeout(() => handleCleanup(), 600);
        }
      },
      onRemoteStream: () => {},
      onStats: (stats, quality) => {
        setCallStats(stats);
        setConnectionQuality(quality);
      },
      onError: (msg) => setError(msg),
    });
    cm.createPeerConnection(socketService.getIceServers());

    cm.onIceCandidate = (candidate: RTCIceCandidateInit) => {
      const targetId =
        currentCallInfo.callerId === userId
          ? currentCallInfo.receiverId
          : currentCallInfo.callerId;
      socketService.emitIceCandidate({
        callId: currentCallInfo.callId,
        fromUserId: userId,
        targetId,
        candidate,
      });
    };

    cm.setCallInfo(currentCallInfo);
    cm.addLocalTrack(stream);
    callManagerRef.current = cm;
  }, [userId, setCallStateWithRef]);

  const startCall = useCallback(
    (receiverId: string, receiverName: string, stream: MediaStream) => {
      if (callStateRef.current !== 'idle') return;
      setError(null);
      const newCallId = generateCallId();
      const newCallInfo: CallInfo = {
        callId: newCallId,
        callerId: userId,
        callerName: userName,
        receiverId,
        receiverName,
        startedAt: Date.now(),
      };
      setCallInfoWithRef(newCallInfo);
      setCallStateWithRef('calling');
      initWebRTC(stream, newCallInfo);

      socketService.emitCallUser({
        callId: newCallId,
        callerId: userId,
        callerName: userName,
        receiverId,
      });

      timeoutsRef.current.outgoing = setTimeout(() => {
        socketService.emitEndCall({
          callId: newCallId,
          fromUserId: userId,
          targetId: receiverId,
          reason: 'timeout',
        });
        handleCleanup('No answer — call timed out');
      }, 30000);
    },
    [userId, userName, initWebRTC, handleCleanup, setCallInfoWithRef, setCallStateWithRef]
  );

  const acceptCall = useCallback(
    (stream: MediaStream) => {
      const info = callInfoRef.current;
      if (callStateRef.current !== 'ringing' || !info) return;
      clearAllTimeouts();
      setCallStateWithRef('connecting');
      initWebRTC(stream, info);

      socketService.emitCallAccepted({
        callId: info.callId,
        callerId: info.callerId,
        receiverId: userId,
        receiverName: userName,
      });

      timeoutsRef.current.connecting = setTimeout(() => {
        handleCleanup('Connection timed out');
      }, 30000);
    },
    [userId, userName, initWebRTC, clearAllTimeouts, handleCleanup, setCallStateWithRef]
  );

  const rejectCall = useCallback(
    (reason: string = 'declined') => {
      const info = callInfoRef.current;
      if (!info) return;
      socketService.emitCallRejected({ callId: info.callId, receiverId: userId, reason });
      // Also need to notify callerId — server handles routing via callerId
      handleCleanup();
    },
    [userId, handleCleanup]
  );

  const endCall = useCallback(() => {
    const info = callInfoRef.current;
    if (info) {
      const targetId = info.callerId === userId ? info.receiverId : info.callerId;
      socketService.emitEndCall({
        callId: info.callId,
        fromUserId: userId,
        targetId,
        reason: 'ended_by_user',
      });
    }
    handleCleanup();
  }, [userId, handleCleanup]);

  const toggleMute = useCallback(() => {
    if (!callManagerRef.current) return;
    setIsMuted((prev) => {
      const next = !prev;
      callManagerRef.current?.setLocalAudioEnabled(!next);
      return next;
    });
  }, []);

  return {
    callState,
    callInfo,
    callStats,
    connectionQuality,
    error,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    isMuted,
    toggleMute,
  };
}
