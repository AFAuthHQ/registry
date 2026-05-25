import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

export const fetchMock = setupServer();

beforeAll(() => fetchMock.listen({ onUnhandledRequest: 'error' }));
afterEach(() => fetchMock.resetHandlers());
afterAll(() => fetchMock.close());

export interface MockedHost {
  proof?: { body: string; contentType?: string; status?: number };
  discovery?: { doc: unknown; status?: number };
}

export function mockHost(host: string, opts: MockedHost): void {
  const handlers = [];
  if (opts.proof) {
    handlers.push(
      http.get(`https://${host}/.well-known/afauth-registry-proof`, () =>
        HttpResponse.text(opts.proof!.body, {
          status: opts.proof!.status ?? 200,
          headers: {
            'content-type': opts.proof!.contentType ?? 'text/plain; charset=utf-8',
          },
        }),
      ),
    );
  }
  if (opts.discovery) {
    const doc = opts.discovery.doc;
    handlers.push(
      http.get(`https://${host}/.well-known/afauth`, () =>
        HttpResponse.json(doc as Parameters<typeof HttpResponse.json>[0], {
          status: opts.discovery!.status ?? 200,
        }),
      ),
    );
  }
  fetchMock.use(...handlers);
}

import type { DiscoveryDoc } from '../../src/lib/schemas.js';

export function validDiscoveryDoc(did = 'did:web:api.example.com'): DiscoveryDoc {
  return {
    afauth_version: '0.1',
    service_did: did,
    endpoints: {
      accounts: '/v1/accounts',
      owner_invitation: '/v1/owner-invitation',
      claim_page: 'https://api.example.com/claim',
      claim_completion: '/v1/claim',
    },
    signature_algorithms: ['ed25519'],
  };
}

export { HttpResponse, http };
