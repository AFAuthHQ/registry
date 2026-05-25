import { Hono } from 'hono';
import type Redis from 'ioredis';
import { didWebHost } from '../lib/did.js';
import { RegistryError } from '../lib/errors.js';
import { fetchText, hostFromUrl } from '../lib/fetch.js';
import {
  ChallengeRequestSchema,
  DiscoveryDocSchema,
  ListingPatchSchema,
  ListingSubmitSchema,
  ServiceDidSchema,
  type DiscoveryDoc,
} from '../lib/schemas.js';
import type { Store } from '../lib/store/index.js';
import { generateToken } from '../lib/tokens.js';

export const CHALLENGE_TTL_SECONDS = 30 * 60;
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;
export const PROOF_PATH = '/.well-known/afauth-registry-proof';

const MAX_ACTIVE_CHALLENGES_PER_HOST = 10;
const PER_HOST_CHALLENGE_WINDOW_SECONDS = 3600;

export interface ChallengeRecord {
  discovery_url: string;
  host: string;
  expires_at: string;
}

export interface SessionRecord {
  service_did: string;
  expires_at: string;
}

interface Deps {
  store: Store;
  redis: Redis;
}

export function createListingRoutes(deps: Deps): Hono {
  const { store, redis } = deps;
  const r = new Hono();

  r.post('/challenge', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ChallengeRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw RegistryError.invalidRequest('Invalid challenge request', {
        issues: parsed.error.issues,
      });
    }
    const { discovery_url } = parsed.data;
    const host = hostFromUrl(discovery_url);

    const counterKey = `challenge:host:${host}`;
    const count = await redis.incr(counterKey);
    if (count === 1) await redis.expire(counterKey, PER_HOST_CHALLENGE_WINDOW_SECONDS);
    if (count > MAX_ACTIVE_CHALLENGES_PER_HOST) {
      throw RegistryError.rateLimited('Too many active challenges for this host');
    }

    const token = generateToken('ch');
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
    const record: ChallengeRecord = {
      discovery_url,
      host,
      expires_at: expiresAt.toISOString(),
    };
    await redis.setex(`challenge:${token}`, CHALLENGE_TTL_SECONDS, JSON.stringify(record));

    return c.json({
      challenge_token: token,
      proof_url: `https://${host}${PROOF_PATH}`,
      expires_at: expiresAt.toISOString(),
    });
  });

  r.post('/', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ListingSubmitSchema.safeParse(body);
    if (!parsed.success) {
      throw RegistryError.invalidRequest('Invalid submission', {
        issues: parsed.error.issues,
      });
    }
    const { discovery_url, challenge_token, title, description, tags } = parsed.data;

    const challengeKey = `challenge:${challenge_token}`;
    const raw = await redis.get(challengeKey);
    if (!raw) {
      throw new RegistryError(
        'invalid_challenge',
        'Challenge token is invalid or expired',
        400,
      );
    }
    const challenge: ChallengeRecord = JSON.parse(raw);

    if (challenge.discovery_url !== discovery_url) {
      throw new RegistryError(
        'proof_mismatch',
        'Challenge does not match submitted discovery_url',
        400,
      );
    }

    const consumed = await redis.del(challengeKey);
    if (consumed === 0) {
      throw new RegistryError(
        'challenge_already_used',
        'Challenge was already consumed',
        409,
      );
    }

    const host = challenge.host;
    const proofUrl = `https://${host}${PROOF_PATH}`;

    const proofResp = await fetchText(proofUrl, { expectContentType: 'text/plain' });
    if (!proofResp.ok) {
      throw new RegistryError(
        'proof_fetch_failed',
        `Could not fetch proof: ${proofResp.message}`,
        400,
        { url: proofUrl },
      );
    }
    if (proofResp.body !== challenge_token) {
      throw new RegistryError(
        'proof_mismatch',
        'Proof body does not match challenge token',
        400,
      );
    }

    const docResp = await fetchText(discovery_url);
    if (!docResp.ok) {
      throw new RegistryError(
        'discovery_fetch_failed',
        `Could not fetch discovery doc: ${docResp.message}`,
        400,
        { url: discovery_url },
      );
    }
    let docJson: unknown;
    try {
      docJson = JSON.parse(docResp.body);
    } catch {
      throw new RegistryError(
        'discovery_invalid',
        'Discovery document is not valid JSON',
        400,
      );
    }
    const docParsed = DiscoveryDocSchema.safeParse(docJson);
    if (!docParsed.success) {
      throw new RegistryError(
        'discovery_invalid',
        'Discovery document failed schema validation',
        400,
        { issues: docParsed.error.issues },
      );
    }
    const doc: DiscoveryDoc = docParsed.data;
    const serviceDid = doc.service_did;

    if (serviceDid.startsWith('did:web:')) {
      const expectedHost = didWebHost(serviceDid);
      if (!expectedHost || expectedHost !== host) {
        throw new RegistryError(
          'discovery_did_mismatch',
          'did:web host does not match discovery host',
          400,
          { did_host: expectedHost, discovery_host: host },
        );
      }
    }

    const existing = await store.getByDid(serviceDid);
    if (existing) {
      if (existing.discovery_host !== host) {
        throw RegistryError.conflict(
          'Service DID is already listed under a different host',
          { existing_host: existing.discovery_host, submitted_host: host },
        );
      }
      await revokePriorSessions(redis, serviceDid);
      await store.markRevalidationSuccess(serviceDid, doc, new Date());
      if (title !== undefined || description !== undefined || tags !== undefined) {
        await store.update(serviceDid, { title, description, tags });
      }
      const { token, expiresAt } = await issueSession(redis, serviceDid);
      return c.json(
        { service_did: serviceDid, session_token: token, expires_at: expiresAt },
        200,
      );
    }

    const byHost = await store.getByHost(host);
    if (byHost) {
      throw RegistryError.conflict(
        'Discovery host is already listed for a different service_did',
        { existing_did: byHost.service_did },
      );
    }

    try {
      await store.create({
        service_did: serviceDid,
        discovery_url,
        discovery_host: host,
        discovery_doc: doc,
        title,
        description,
        tags,
      });
    } catch (err) {
      throw RegistryError.conflict('Could not create listing', {
        reason: err instanceof Error ? err.message : 'unknown',
      });
    }

    const { token, expiresAt } = await issueSession(redis, serviceDid);
    return c.json(
      { service_did: serviceDid, session_token: token, expires_at: expiresAt },
      201,
    );
  });

  r.patch('/:did{.+}', async (c) => {
    const did = decodeURIComponent(c.req.param('did'));
    if (!ServiceDidSchema.safeParse(did).success) {
      throw RegistryError.invalidRequest('Invalid service_did in path');
    }
    const session = await requireSession(redis, c.req.header('authorization'));
    if (session.service_did !== did) {
      throw RegistryError.forbidden('Session is not bound to this service_did');
    }
    const body = await c.req.json().catch(() => null);
    const parsed = ListingPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw RegistryError.invalidRequest('Invalid patch', {
        issues: parsed.error.issues,
      });
    }
    const updated = await store.update(did, parsed.data);
    if (!updated || updated.status === 'deleted') {
      throw RegistryError.notFound('Listing not found');
    }
    return c.json(updated);
  });

  r.delete('/:did{.+}', async (c) => {
    const did = decodeURIComponent(c.req.param('did'));
    if (!ServiceDidSchema.safeParse(did).success) {
      throw RegistryError.invalidRequest('Invalid service_did in path');
    }
    const session = await requireSession(redis, c.req.header('authorization'));
    if (session.service_did !== did) {
      throw RegistryError.forbidden('Session is not bound to this service_did');
    }
    const existing = await store.getByDid(did);
    if (!existing || existing.status === 'deleted') {
      throw RegistryError.notFound('Listing not found');
    }
    await store.softDelete(did);
    return c.body(null, 204);
  });

  return r;
}

async function requireSession(
  redis: Redis,
  authHeader: string | undefined,
): Promise<SessionRecord> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw RegistryError.unauthorized('Missing bearer token');
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) throw RegistryError.unauthorized('Empty bearer token');
  const raw = await redis.get(`session:${token}`);
  if (!raw) throw RegistryError.unauthorized('Invalid or expired session token');
  return JSON.parse(raw) as SessionRecord;
}

async function issueSession(
  redis: Redis,
  serviceDid: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = generateToken('sess');
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const record: SessionRecord = { service_did: serviceDid, expires_at: expiresAt };
  const sessionsKey = `session:by-did:${serviceDid}`;
  const pipeline = redis.pipeline();
  pipeline.setex(`session:${token}`, SESSION_TTL_SECONDS, JSON.stringify(record));
  pipeline.sadd(sessionsKey, token);
  pipeline.expire(sessionsKey, SESSION_TTL_SECONDS);
  await pipeline.exec();
  return { token, expiresAt };
}

async function revokePriorSessions(redis: Redis, serviceDid: string): Promise<void> {
  const sessionsKey = `session:by-did:${serviceDid}`;
  const priorTokens = await redis.smembers(sessionsKey);
  if (priorTokens.length === 0) return;
  const pipeline = redis.pipeline();
  for (const t of priorTokens) pipeline.del(`session:${t}`);
  pipeline.del(sessionsKey);
  await pipeline.exec();
}
