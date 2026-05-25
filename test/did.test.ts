import { describe, expect, it } from 'vitest';
import { didWebHost } from '../src/lib/did.js';

describe('didWebHost', () => {
  it('extracts the host from a simple did:web', () => {
    expect(didWebHost('did:web:api.example.com')).toBe('api.example.com');
  });

  it('returns null for non-did:web identifiers', () => {
    expect(didWebHost('did:key:z6Mk123')).toBeNull();
    expect(didWebHost('https://example.com')).toBeNull();
  });

  it('extracts host when did:web has subpath segments', () => {
    expect(didWebHost('did:web:example.com:user:alice')).toBe('example.com');
  });

  it('URL-decodes encoded port', () => {
    expect(didWebHost('did:web:example.com%3A3000')).toBe('example.com:3000');
  });
});
