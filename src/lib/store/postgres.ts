import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { getConfig } from '../config.js';
import type { DiscoveryDoc } from '../schemas.js';
import type {
  CreateListingInput,
  ListingRecord,
  ListQuery,
  ListResult,
  Store,
  UpdateListingInput,
} from './index.js';

interface Row {
  service_did: string;
  discovery_url: string;
  discovery_host: string;
  discovery_doc: DiscoveryDoc;
  fetched_at: Date;
  first_listed_at: Date;
  updated_at: Date;
  status: 'active' | 'stale' | 'deleted';
  consecutive_fails: number;
  first_failed_at: Date | null;
  title: string | null;
  description: string | null;
  tags: string[];
  meta: Record<string, unknown>;
}

function rowToRecord(row: Row): ListingRecord {
  return {
    service_did: row.service_did,
    discovery_url: row.discovery_url,
    discovery_host: row.discovery_host,
    discovery_doc: row.discovery_doc,
    fetched_at: row.fetched_at.toISOString(),
    first_listed_at: row.first_listed_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    status: row.status,
    consecutive_fails: row.consecutive_fails,
    first_failed_at: row.first_failed_at?.toISOString() ?? null,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    tags: row.tags,
    _meta: row.meta,
  };
}

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

export class PgStore implements Store {
  readonly pool: Pool;

  constructor(connectionString?: string) {
    this.pool = new Pool({
      connectionString: connectionString ?? getConfig().DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }

  async init(): Promise<void> {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '0001_init.sql'),
      'utf8',
    );
    const client = await this.pool.connect();
    try {
      await client.query(sql);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getByDid(serviceDid: string): Promise<ListingRecord | null> {
    const { rows } = await this.pool.query<Row>(
      'SELECT * FROM listings WHERE service_did = $1',
      [serviceDid],
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async getByHost(host: string): Promise<ListingRecord | null> {
    const { rows } = await this.pool.query<Row>(
      'SELECT * FROM listings WHERE discovery_host = $1',
      [host],
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async create(input: CreateListingInput): Promise<ListingRecord> {
    const now = new Date();
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO listings (
         service_did, discovery_url, discovery_host, discovery_doc,
         fetched_at, first_listed_at, updated_at, status,
         consecutive_fails, first_failed_at, title, description, tags, meta
       ) VALUES ($1,$2,$3,$4,$5,$5,$5,'active',0,NULL,$6,$7,$8,'{}'::jsonb)
       RETURNING *`,
      [
        input.service_did,
        input.discovery_url,
        input.discovery_host,
        input.discovery_doc,
        now,
        input.title ?? null,
        input.description ?? null,
        input.tags ?? [],
      ],
    );
    return rowToRecord(rows[0]!);
  }

  async update(serviceDid: string, input: UpdateListingInput): Promise<ListingRecord | null> {
    const sets: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let i = 1;
    if (input.title !== undefined) {
      sets.push(`title = $${i++}`);
      values.push(input.title);
    }
    if (input.description !== undefined) {
      sets.push(`description = $${i++}`);
      values.push(input.description);
    }
    if (input.tags !== undefined) {
      sets.push(`tags = $${i++}`);
      values.push(input.tags);
    }
    values.push(serviceDid);
    const { rows } = await this.pool.query<Row>(
      `UPDATE listings SET ${sets.join(', ')} WHERE service_did = $${i} RETURNING *`,
      values,
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async softDelete(serviceDid: string): Promise<ListingRecord | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE listings SET status = 'deleted', updated_at = NOW()
       WHERE service_did = $1 RETURNING *`,
      [serviceDid],
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async list(query: ListQuery): Promise<ListResult> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (!query.include_deleted) {
      conditions.push(`status <> 'deleted'`);
    }
    if (query.status) {
      conditions.push(`status = $${i++}`);
      values.push(query.status);
    }
    if (query.tag) {
      conditions.push(`$${i++} = ANY(tags)`);
      values.push(query.tag);
    }
    if (query.search) {
      conditions.push(`(title ILIKE $${i} OR description ILIKE $${i})`);
      values.push(`%${query.search}%`);
      i++;
    }
    if (query.updated_since) {
      conditions.push(`updated_at >= $${i++}`);
      values.push(new Date(query.updated_since));
    }
    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      if (decoded) {
        conditions.push(`(updated_at, service_did) > ($${i++}, $${i++})`);
        values.push(new Date(decoded.updatedAt));
        values.push(decoded.did);
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(limit + 1);
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM listings ${where}
       ORDER BY updated_at ASC, service_did ASC
       LIMIT $${i}`,
      values,
    );

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor(last.updated_at.toISOString(), last.service_did) : null;

    return {
      listings: page.map(rowToRecord),
      next_cursor: nextCursor,
    };
  }

  async markRevalidationSuccess(
    serviceDid: string,
    doc: DiscoveryDoc,
    fetchedAt: Date,
  ): Promise<ListingRecord | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE listings
         SET discovery_doc = $1,
             fetched_at = $2,
             updated_at = NOW(),
             status = 'active',
             consecutive_fails = 0,
             first_failed_at = NULL
         WHERE service_did = $3 AND status <> 'deleted'
       RETURNING *`,
      [doc, fetchedAt, serviceDid],
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async markRevalidationFailure(
    serviceDid: string,
    failedAt: Date,
  ): Promise<ListingRecord | null> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existing } = await client.query<Row>(
        `SELECT * FROM listings WHERE service_did = $1 AND status <> 'deleted' FOR UPDATE`,
        [serviceDid],
      );
      const row = existing[0];
      if (!row) {
        await client.query('ROLLBACK');
        return null;
      }
      const nextFails = row.consecutive_fails + 1;
      const nextStatus = nextFails >= 3 ? 'stale' : row.status;
      const firstFailedAt = row.first_failed_at ?? failedAt;

      const { rows: updated } = await client.query<Row>(
        `UPDATE listings
           SET consecutive_fails = $1,
               first_failed_at = $2,
               status = $3,
               updated_at = NOW()
           WHERE service_did = $4
         RETURNING *`,
        [nextFails, firstFailedAt, nextStatus, serviceDid],
      );
      await client.query('COMMIT');
      return updated[0] ? rowToRecord(updated[0]) : null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listDueForRevalidation(olderThan: Date, limit: number): Promise<ListingRecord[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM listings
        WHERE status <> 'deleted'
          AND fetched_at < $1
        ORDER BY fetched_at ASC
        LIMIT $2`,
      [olderThan, limit],
    );
    return rows.map(rowToRecord);
  }

  async listStaleBeyondGrace(graceCutoff: Date, limit: number): Promise<ListingRecord[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM listings
        WHERE status = 'stale'
          AND first_failed_at IS NOT NULL
          AND first_failed_at < $1
        ORDER BY first_failed_at ASC
        LIMIT $2`,
      [graceCutoff, limit],
    );
    return rows.map(rowToRecord);
  }
}
