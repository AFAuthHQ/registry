import type { DiscoveryDoc, Listing, ListingStatus } from '../schemas.js';

export interface ListingRecord extends Listing {
  consecutive_fails: number;
  first_failed_at: string | null;
  updated_at: string;
  discovery_host: string;
}

export interface ListQuery {
  cursor?: string;
  limit?: number;
  search?: string;
  tag?: string;
  updated_since?: string;
  status?: ListingStatus;
  include_deleted?: boolean;
}

export interface ListResult {
  listings: ListingRecord[];
  next_cursor: string | null;
}

export interface CreateListingInput {
  service_did: string;
  discovery_url: string;
  discovery_host: string;
  discovery_doc: DiscoveryDoc;
  title?: string;
  description?: string;
  tags?: string[];
}

export interface UpdateListingInput {
  title?: string;
  description?: string;
  tags?: string[];
}

export interface Store {
  /** Idempotent schema setup; safe to call on every boot. */
  init(): Promise<void>;

  /** Closes pool / disconnects; used in tests and graceful shutdown. */
  close(): Promise<void>;

  /** Returns the listing for a service_did or null. */
  getByDid(serviceDid: string): Promise<ListingRecord | null>;

  /** Returns the listing currently bound to a discovery host or null. */
  getByHost(host: string): Promise<ListingRecord | null>;

  /** Inserts a brand-new listing. Throws on host or DID collision. */
  create(input: CreateListingInput): Promise<ListingRecord>;

  /**
   * Applies a partial update to writeable fields and bumps updated_at.
   * Returns the post-update record, or null if the listing was not found.
   */
  update(serviceDid: string, input: UpdateListingInput): Promise<ListingRecord | null>;

  /**
   * Soft-deletes by setting status='deleted' and bumping updated_at.
   * Returns the post-update record, or null if not found.
   */
  softDelete(serviceDid: string): Promise<ListingRecord | null>;

  /** Lists with cursor pagination and filters; see §5. */
  list(query: ListQuery): Promise<ListResult>;

  /**
   * Marks a successful revalidation: resets failure counters,
   * updates discovery_doc + fetched_at, status → 'active'.
   */
  markRevalidationSuccess(
    serviceDid: string,
    doc: DiscoveryDoc,
    fetchedAt: Date,
  ): Promise<ListingRecord | null>;

  /**
   * Records a failed revalidation tick. After 3 consecutive failures the
   * listing transitions to 'stale'. The first failure timestamp is sticky
   * until a success resets it.
   */
  markRevalidationFailure(serviceDid: string, failedAt: Date): Promise<ListingRecord | null>;

  /**
   * Returns listings whose `updated_at` is older than `olderThan`
   * (used by the cron to pick revalidation candidates).
   * Excludes already-deleted listings.
   */
  listDueForRevalidation(olderThan: Date, limit: number): Promise<ListingRecord[]>;

  /**
   * Returns stale listings whose first_failed_at is older than `graceCutoff`,
   * eligible for transition to 'deleted'.
   */
  listStaleBeyondGrace(graceCutoff: Date, limit: number): Promise<ListingRecord[]>;
}
