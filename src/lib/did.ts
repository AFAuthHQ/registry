/**
 * Helpers for working with DID identifiers used by the directory.
 * Only did:web and did:key are accepted (per spec §3).
 */

/**
 * Extracts the host portion of a did:web identifier. Per the did:web
 * method, the part after `did:web:` is a percent-encoded host, optionally
 * followed by `:`-separated path segments. The directory only cares about
 * the host, since that is the DNS+TLS anchor.
 *
 * Returns null for non-did:web identifiers.
 */
export function didWebHost(did: string): string | null {
  if (!did.startsWith('did:web:')) return null;
  const rest = did.slice('did:web:'.length);
  const colonIdx = rest.indexOf(':');
  const hostPart = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
  try {
    return decodeURIComponent(hostPart);
  } catch {
    return null;
  }
}
