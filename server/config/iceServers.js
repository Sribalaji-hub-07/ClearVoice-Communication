/**
 * ICE server configuration, driven entirely by environment variables.
 * TURN credentials are never hard-coded and never shipped to the public bundle
 * except over the authenticated signaling socket.
 */

const STUN_URL = process.env.STUN_URL || 'stun:stun.l.google.com:19302';
const STUN_URL_2 = process.env.STUN_URL_2 || '';
const TURN_URL = process.env.TURN_URL || '';
const TURN_USERNAME = process.env.TURN_USERNAME || '';
const TURN_CREDENTIAL = process.env.TURN_CREDENTIAL || '';

export function getIceServers() {
  const servers = [{ urls: STUN_URL }];
  if (STUN_URL_2) servers.push({ urls: STUN_URL_2 });

  if (TURN_URL && TURN_USERNAME && TURN_CREDENTIAL) {
    servers.push({
      urls: TURN_URL,
      username: TURN_USERNAME,
      credential: TURN_CREDENTIAL,
    });
  }
  return servers;
}

export function iceStatus() {
  const turnReady = Boolean(TURN_URL && TURN_USERNAME && TURN_CREDENTIAL);
  return {
    stun: STUN_URL,
    turnConfigured: turnReady,
    note: turnReady
      ? 'STUN + TURN available; relay candidates will be offered.'
      : 'STUN only. Symmetric-NAT peers need TURN_URL, TURN_USERNAME and TURN_CREDENTIAL set.',
  };
}

export function warnOnce(log = console.warn) {
  if (!TURN_URL || !TURN_USERNAME || !TURN_CREDENTIAL) {
    log(
      '[clearvoice] TURN is not configured. Direct and srflx candidates only - ' +
        'calls behind symmetric NAT will fail. Set TURN_URL, TURN_USERNAME, TURN_CREDENTIAL.',
    );
  }
}
