import { describe, expect, it } from 'vitest';
import {
  ChallengeRequestSchema,
  DiscoveryDocSchema,
  ListingPatchSchema,
  ListingSubmitSchema,
  ServiceDidSchema,
} from '../src/lib/schemas.js';

describe('ServiceDidSchema', () => {
  it('accepts did:web', () => {
    expect(ServiceDidSchema.safeParse('did:web:api.example.com').success).toBe(true);
  });

  it('accepts did:key', () => {
    expect(ServiceDidSchema.safeParse('did:key:z6MkfV').success).toBe(true);
  });

  it('rejects unknown DID methods', () => {
    expect(ServiceDidSchema.safeParse('did:ion:foo').success).toBe(false);
    expect(ServiceDidSchema.safeParse('https://example.com').success).toBe(false);
  });
});

describe('DiscoveryDocSchema', () => {
  it('accepts a minimal valid discovery document', () => {
    const doc = {
      afauth_version: '0.1',
      service_did: 'did:web:api.example.com',
      endpoints: {
        accounts: '/v1/accounts',
        owner_invitation: '/v1/owner-invitation',
        claim_page: 'https://api.example.com/claim',
        claim_completion: '/v1/claim',
      },
      signature_algorithms: ['ed25519'],
    };
    const parsed = DiscoveryDocSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
  });

  it('rejects when service_did is malformed', () => {
    const doc = {
      afauth_version: '0.1',
      service_did: 'not-a-did',
      endpoints: {
        accounts: '/v1/accounts',
        owner_invitation: '/v1/owner-invitation',
        claim_page: 'https://api.example.com/claim',
        claim_completion: '/v1/claim',
      },
      signature_algorithms: ['ed25519'],
    };
    expect(DiscoveryDocSchema.safeParse(doc).success).toBe(false);
  });
});

describe('ChallengeRequestSchema', () => {
  it('requires https discovery_url', () => {
    expect(
      ChallengeRequestSchema.safeParse({
        discovery_url: 'http://example.com/.well-known/afauth',
      }).success,
    ).toBe(false);
    expect(
      ChallengeRequestSchema.safeParse({
        discovery_url: 'https://example.com/.well-known/afauth',
      }).success,
    ).toBe(true);
  });
});

describe('ListingSubmitSchema', () => {
  it('requires challenge_token in ch_ + 22-char base64url format', () => {
    const base = {
      discovery_url: 'https://example.com/.well-known/afauth',
    };
    expect(
      ListingSubmitSchema.safeParse({ ...base, challenge_token: 'bad' }).success,
    ).toBe(false);
    // Wrong length — too short
    expect(
      ListingSubmitSchema.safeParse({ ...base, challenge_token: 'ch_abc123' }).success,
    ).toBe(false);
    // Correct format: ch_ + 22 base64url chars
    expect(
      ListingSubmitSchema.safeParse({
        ...base,
        challenge_token: 'ch_AbCd1ef-gHIj_klmN0pqRs',
      }).success,
    ).toBe(true);
  });

  it('rejects discovery_url with a private/loopback hostname', () => {
    const challenge_token = 'ch_AbCd1ef-gHIj_klmN0pqRs';
    expect(
      ListingSubmitSchema.safeParse({
        challenge_token,
        discovery_url: 'https://localhost/.well-known/afauth',
      }).success,
    ).toBe(false);
    expect(
      ListingSubmitSchema.safeParse({
        challenge_token,
        discovery_url: 'https://127.0.0.1/.well-known/afauth',
      }).success,
    ).toBe(false);
    expect(
      ListingSubmitSchema.safeParse({
        challenge_token,
        discovery_url: 'https://10.0.0.5/.well-known/afauth',
      }).success,
    ).toBe(false);
    expect(
      ListingSubmitSchema.safeParse({
        challenge_token,
        discovery_url: 'https://[::1]/.well-known/afauth',
      }).success,
    ).toBe(false);
  });
});

describe('ListingPatchSchema', () => {
  it('rejects unknown fields', () => {
    expect(
      ListingPatchSchema.safeParse({
        title: 'New title',
        discovery_url: 'https://other.example.com/.well-known/afauth',
      }).success,
    ).toBe(false);
  });

  it('accepts a partial update', () => {
    expect(ListingPatchSchema.safeParse({ tags: ['photos'] }).success).toBe(true);
  });
});
