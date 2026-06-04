import { z } from 'zod';
import { isPrivateLiteralOrHostname } from './host-validation.js';

export const ServiceDidSchema = z
  .string()
  .regex(/^did:(web|key):.+/, 'service_did must match did:web: or did:key:');

export const DiscoveryUrlSchema = z
  .string()
  .url()
  .refine((s) => s.startsWith('https://'), 'discovery_url must use https://')
  .refine((s) => {
    try {
      return !isPrivateLiteralOrHostname(new URL(s).hostname);
    } catch {
      return false;
    }
  }, 'discovery_url must use a publicly reachable hostname (not localhost, .local, RFC1918, etc.)');

export const DiscoveryDocSchema = z
  .object({
    afauth_version: z.string(),
    service_did: ServiceDidSchema,
    endpoints: z
      .object({
        accounts: z.string(),
        owner_invitation: z.string(),
        claim_page: z.string().url(),
        claim_completion: z.string(),
        key_rotation: z.string().optional(),
      })
      .passthrough(),
    signature_algorithms: z
      .array(z.enum(['ed25519', 'ecdsa-p256-sha256']))
      .min(1),
    features: z.array(z.enum(['attestation', 'key_rotation'])).optional(),
    recipient_types: z
      .array(z.enum(['email', 'phone', 'oidc', 'did']))
      .min(1)
      .optional(),
    limits: z
      .object({
        // Optional and off by default: absent means unclaimed accounts never
        // expire (the recommended posture). If a service does opt into a TTL,
        // the spec floor is 3600s (well-known.json §4.4).
        unclaimed_ttl_seconds: z.number().int().min(3600).optional(),
        unclaimed_rate_limit_per_hour: z.number().int().min(0).optional(),
      })
      .optional(),
    billing: z
      .object({
        unclaimed_mode: z.enum(['free', 'attested_only', 'denied']),
        accepted_attestors: z.array(z.string()).optional(),
      })
      .optional(),
    x402: z
      .object({
        facilitator: z.string().url(),
        networks: z.array(z.string()).min(1),
        assets: z.array(z.string()).min(1),
        payment_endpoint: z.string().url(),
      })
      .optional(),
  })
  .passthrough();

export type DiscoveryDoc = z.infer<typeof DiscoveryDocSchema>;

export const ListingStatusSchema = z.enum(['active', 'stale', 'deleted']);
export type ListingStatus = z.infer<typeof ListingStatusSchema>;

export const ListingSchema = z.object({
  service_did: ServiceDidSchema,
  discovery_url: DiscoveryUrlSchema,
  discovery_doc: DiscoveryDocSchema,
  fetched_at: z.string().datetime(),
  first_listed_at: z.string().datetime(),
  status: ListingStatusSchema,
  tags: z.array(z.string()).default([]),
  title: z.string().optional(),
  description: z.string().optional(),
  _meta: z.record(z.unknown()).optional(),
});

export type Listing = z.infer<typeof ListingSchema>;

export const ChallengeRequestSchema = z.object({
  discovery_url: DiscoveryUrlSchema,
});

export const ListingSubmitSchema = z.object({
  discovery_url: DiscoveryUrlSchema,
  challenge_token: z.string().regex(/^ch_[A-Za-z0-9_-]{22}$/),
  title: z.string().max(120).optional(),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

export const ListingPatchSchema = z
  .object({
    title: z.string().max(120).optional(),
    description: z.string().max(500).optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
  })
  .strict();
