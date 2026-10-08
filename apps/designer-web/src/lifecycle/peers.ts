/**
 * Collaboration presence helpers (DIFFERENTIATORS C1). Each person gets a stable tone from the
 * design system's semantic colours (never danger, which means "error"), so the same colleague has
 * the same colour on every screen and in every session.
 */
export const PEER_TONES = [
  'info',
  'success',
  'warning',
  'primary',
  'focus',
  'brand-accent',
] as const;
export type PeerTone = (typeof PEER_TONES)[number];

/** FNV-1a over the user id: deterministic, evenly spread, no randomness. */
export function peerTone(userId: string): PeerTone {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PEER_TONES[hash % PEER_TONES.length] ?? 'info';
}

export interface FollowedPeer {
  userId: string;
  pageId: string;
  selection: readonly string[];
}

/**
 * Where following a colleague should take the local view: their page, and the first node they
 * have selected (to scroll to, never to select: following must not broadcast a selection).
 */
export function followView(
  peers: readonly FollowedPeer[],
  following: string | null,
): { pageId: string; nodeId: string | undefined } | null {
  if (!following) return null;
  const peer = peers.find((candidate) => candidate.userId === following);
  if (!peer) return null;
  return { pageId: peer.pageId, nodeId: peer.selection[0] };
}
