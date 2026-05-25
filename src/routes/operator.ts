import { Hono } from 'hono';
import { html } from 'hono/html';
import { layout } from '../views/layout.js';

export const operatorRoutes = new Hono();

operatorRoutes.get('/operator', (c) => {
  return c.html(
    layout({
      title: 'Operator commitment · registry.afauth.org',
      body: html`
        <h1>Operator commitment</h1>
        <p>
          <strong>AFAuthHQ</strong> operates <code>registry.afauth.org</code> in
          this version of the directory. This page is the public commitment
          required by §9 of
          <a href="https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md">spec/directory.md</a>.
        </p>
        <p>
          The directory is informational and non-normative. AFAuth agents
          and services are not required to interact with it, and a
          conforming implementation that ignores this directory entirely
          remains conforming. If <code>afauth.org</code> were to
          disappear, every conforming agent and service would continue
          working unchanged.
        </p>

        <h2>Who has operational authority</h2>
        <p>
          AFAuthHQ. Operational contact:
          <a href="mailto:[email protected]">[email protected]</a>.
        </p>

        <h2>Actions the operator MAY take unilaterally</h2>
        <ul>
          <li>Routine moderation per the published
            <a href="/policy">take-down policy</a>: removing or
            soft-deleting listings that violate the policy.</li>
          <li>Infrastructure changes (hosting provider, runtime
            version, internal storage layout) that preserve the public
            API surface defined in
            <a href="https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md#5-read-api">§5</a>
            and the listing schema in
            <a href="https://github.com/AFAuthHQ/spec/blob/main/schemas/listing.json">schemas/listing.json</a>.</li>
          <li>Schema-conformant data migrations that do not change a
            listing's <code>service_did</code>, <code>discovery_url</code>,
            <code>first_listed_at</code>, or visible status to consumers.</li>
          <li>Re-issuing the operator commitment and take-down policy
            text to clarify, in ways that do not narrow the operator's
            obligations to listing controllers.</li>
        </ul>

        <h2>Actions the operator MUST NOT take unilaterally</h2>
        <ul>
          <li>Delist or hide a service outside the published
            <a href="/policy">moderation policy</a>.</li>
          <li>Apply breaking-change schema amendments. Schema changes
            that remove or rename required fields, or that alter their
            semantics, require a versioned spec revision in
            <a href="https://github.com/AFAuthHQ/spec">AFAuthHQ/spec</a>
            and a deprecation window.</li>
          <li>Censor listings on ideological grounds. Authority for
            listings derives from proof of control of the discovery
            host (§4); legitimate controllers may not be removed for
            disagreement with content unrelated to the policy.</li>
        </ul>

        <h2>Federation</h2>
        <p>
          The directory is <strong>not the protocol's single source of
          truth.</strong> Anyone may host a directory implementing the same
          surface; agents and aggregators may consume any directory or
          several. The listing schema is at
          <a href="https://github.com/AFAuthHQ/spec/blob/main/schemas/listing.json">schemas/listing.json</a>
          and is versioned alongside the spec.
        </p>
        <p>
          See
          <a href="https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md#8-federation">§8 federation</a>
          for mirror, aggregator, and private-directory patterns.
        </p>

        <h2>Governance evolution</h2>
        <p>
          A steering committee, donation to a neutral standards home, or
          multi-operator co-stewardship may be addressed in a follow-up
          revision of the spec once adoption warrants it. This page does
          not commit AFAuthHQ to a specific governance trajectory in
          advance of that evidence.
        </p>
      `,
    }),
  );
});
