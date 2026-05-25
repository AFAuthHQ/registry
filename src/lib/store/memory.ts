import type { DiscoveryDoc } from '../schemas.js';
import type {
  CreateListingInput,
  ListingRecord,
  ListQuery,
  ListResult,
  Store,
  UpdateListingInput,
} from './index.js';

function encodeCursor(updatedAt: string, did: string): string {
  return Buffer.from(`${updatedAt}|${did}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { updatedAt: string; did: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = decoded.indexOf('|');
    if (idx < 0) return null;
    return { updatedAt: decoded.slice(0, idx), did: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

export class MemoryStore implements Store {
  private readonly byDid = new Map<string, ListingRecord>();
  private readonly byHost = new Map<string, string>();

  async init(): Promise<void> {}
  async close(): Promise<void> {
    this.byDid.clear();
    this.byHost.clear();
  }

  async getByDid(did: string): Promise<ListingRecord | null> {
    return this.byDid.get(did) ?? null;
  }

  async getByHost(host: string): Promise<ListingRecord | null> {
    const did = this.byHost.get(host);
    return did ? (this.byDid.get(did) ?? null) : null;
  }

  async create(input: CreateListingInput): Promise<ListingRecord> {
    if (this.byDid.has(input.service_did)) {
      throw new Error(`Listing exists for ${input.service_did}`);
    }
    if (this.byHost.has(input.discovery_host)) {
      throw new Error(`Host ${input.discovery_host} already listed`);
    }
    const now = new Date().toISOString();
    const record: ListingRecord = {
      service_did: input.service_did,
      discovery_url: input.discovery_url,
      discovery_host: input.discovery_host,
      discovery_doc: input.discovery_doc,
      fetched_at: now,
      first_listed_at: now,
      updated_at: now,
      status: 'active',
      consecutive_fails: 0,
      first_failed_at: null,
      title: input.title,
      description: input.description,
      tags: input.tags ?? [],
    };
    this.byDid.set(record.service_did, record);
    this.byHost.set(record.discovery_host, record.service_did);
    return record;
  }

  async update(did: string, input: UpdateListingInput): Promise<ListingRecord | null> {
    const existing = this.byDid.get(did);
    if (!existing) return null;
    const updated: ListingRecord = {
      ...existing,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      updated_at: new Date().toISOString(),
    };
    this.byDid.set(did, updated);
    return updated;
  }

  async softDelete(did: string): Promise<ListingRecord | null> {
    const existing = this.byDid.get(did);
    if (!existing) return null;
    const updated: ListingRecord = {
      ...existing,
      status: 'deleted',
      updated_at: new Date().toISOString(),
    };
    this.byDid.set(did, updated);
    return updated;
  }

  async list(query: ListQuery): Promise<ListResult> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    let filtered = Array.from(this.byDid.values());

    if (!query.include_deleted) {
      filtered = filtered.filter((r) => r.status !== 'deleted');
    }
    if (query.status) {
      filtered = filtered.filter((r) => r.status === query.status);
    }
    if (query.tag) {
      filtered = filtered.filter((r) => r.tags.includes(query.tag!));
    }
    if (query.search) {
      const q = query.search.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          (r.title?.toLowerCase().includes(q) ?? false) ||
          (r.description?.toLowerCase().includes(q) ?? false),
      );
    }
    if (query.updated_since) {
      const since = new Date(query.updated_since).toISOString();
      filtered = filtered.filter((r) => r.updated_at >= since);
    }

    filtered.sort((a, b) =>
      a.updated_at === b.updated_at
        ? a.service_did.localeCompare(b.service_did)
        : a.updated_at.localeCompare(b.updated_at),
    );

    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      if (decoded) {
        filtered = filtered.filter(
          (r) =>
            r.updated_at > decoded.updatedAt ||
            (r.updated_at === decoded.updatedAt && r.service_did > decoded.did),
        );
      }
    }

    const page = filtered.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      filtered.length > limit && last ? encodeCursor(last.updated_at, last.service_did) : null;

    return { listings: page, next_cursor: nextCursor };
  }

  async markRevalidationSuccess(
    did: string,
    doc: DiscoveryDoc,
    fetchedAt: Date,
  ): Promise<ListingRecord | null> {
    const existing = this.byDid.get(did);
    if (!existing || existing.status === 'deleted') return null;
    const updated: ListingRecord = {
      ...existing,
      discovery_doc: doc,
      fetched_at: fetchedAt.toISOString(),
      updated_at: new Date().toISOString(),
      status: 'active',
      consecutive_fails: 0,
      first_failed_at: null,
    };
    this.byDid.set(did, updated);
    return updated;
  }

  async markRevalidationFailure(did: string, failedAt: Date): Promise<ListingRecord | null> {
    const existing = this.byDid.get(did);
    if (!existing || existing.status === 'deleted') return null;
    const nextFails = existing.consecutive_fails + 1;
    const updated: ListingRecord = {
      ...existing,
      consecutive_fails: nextFails,
      first_failed_at: existing.first_failed_at ?? failedAt.toISOString(),
      status: nextFails >= 3 ? 'stale' : existing.status,
      updated_at: new Date().toISOString(),
    };
    this.byDid.set(did, updated);
    return updated;
  }

  async listDueForRevalidation(olderThan: Date, limit: number): Promise<ListingRecord[]> {
    const cutoff = olderThan.toISOString();
    return Array.from(this.byDid.values())
      .filter((r) => r.status !== 'deleted' && r.fetched_at < cutoff)
      .sort((a, b) => a.fetched_at.localeCompare(b.fetched_at))
      .slice(0, limit);
  }

  async listStaleBeyondGrace(graceCutoff: Date, limit: number): Promise<ListingRecord[]> {
    const cutoff = graceCutoff.toISOString();
    return Array.from(this.byDid.values())
      .filter(
        (r) =>
          r.status === 'stale' && r.first_failed_at !== null && r.first_failed_at < cutoff,
      )
      .sort((a, b) => (a.first_failed_at ?? '').localeCompare(b.first_failed_at ?? ''))
      .slice(0, limit);
  }
}
