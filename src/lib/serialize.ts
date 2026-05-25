import type { ListingRecord } from './store/index.js';

/**
 * Internal-to-public listing serialization. Strips operational fields
 * (consecutive_fails, first_failed_at, discovery_host) that the spec's
 * schemas/listing.json does not include. Preserves `updated_at` because
 * the §5 paginated list contract — specifically the `updated_since`
 * filter and opaque cursor — only makes sense if the consumer can read
 * the field on the listing it just received.
 */
export interface PublicListing {
  service_did: string;
  discovery_url: string;
  discovery_doc: ListingRecord['discovery_doc'];
  fetched_at: string;
  first_listed_at: string;
  updated_at: string;
  status: ListingRecord['status'];
  tags: string[];
  title?: string;
  description?: string;
  _meta?: Record<string, unknown>;
}

export function toPublicListing(rec: ListingRecord): PublicListing {
  return {
    service_did: rec.service_did,
    discovery_url: rec.discovery_url,
    discovery_doc: rec.discovery_doc,
    fetched_at: rec.fetched_at,
    first_listed_at: rec.first_listed_at,
    updated_at: rec.updated_at,
    status: rec.status,
    tags: rec.tags,
    ...(rec.title !== undefined ? { title: rec.title } : {}),
    ...(rec.description !== undefined ? { description: rec.description } : {}),
    ...(rec._meta !== undefined ? { _meta: rec._meta } : {}),
  };
}
