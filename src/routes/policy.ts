import { Hono } from 'hono';
import { html } from 'hono/html';
import { layout } from '../views/layout.js';

export const policyRoutes = new Hono();

policyRoutes.get('/policy', (c) => {
  return c.html(
    layout({
      title: 'Take-down policy · registry.afauth.org',
      body: html`
        <h1>Take-down policy</h1>
        <p>
          This page is the public take-down policy required by §10 of
          <a href="https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md">spec/directory.md</a>.
          It governs only the canonical directory at
          <code>registry.afauth.org</code>. Mirrors and aggregators set
          their own policies (§8).
        </p>

        <h2>Categories</h2>
        <p>The canonical directory will remove listings that:</p>
        <ul>
          <li>Contain or advertise <strong>illegal content</strong> under
            applicable law.</li>
          <li>Distribute or facilitate <strong>malware</strong>,
            including credential-harvesting endpoints or services
            staged for known phishing campaigns.</li>
          <li>Constitute <strong>spam</strong>: bulk-registered
            listings with no operational service behind them, or
            listings whose
            <code>/.well-known/afauth</code> document is generated
            solely to satisfy the directory's submission protocol
            without a corresponding live service.</li>
          <li>Make <strong>fraudulent claims</strong>: declaring an
            <code>service_did</code>, controller, or operator that
            the listing's discovery host does not legitimately
            represent.</li>
        </ul>

        <h2>Hard-delete vs soft-delete</h2>
        <p>
          By default the directory soft-deletes — sets
          <code>status: "deleted"</code> and retains the record so
          mirrors converge. The soft-deleted record is excluded from
          the default <code>GET /v1/listings</code> response and
          surfaces only when <code>?include_deleted=true</code> is set
          (§10 of the spec).
        </p>
        <p>
          <strong>Hard-erase</strong> — removing the record entirely
          so it disappears from mirrors that re-poll — is reserved
          for unlawful content. The operator will not hard-erase
          listings on the basis of a controller's withdrawal request
          alone; for routine withdrawal, use the
          <a href="https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md#42-update-and-removal">§4.2 <code>DELETE</code> endpoint</a>
          and the listing will soft-delete in the normal way.
        </p>

        <h2>Procedure</h2>
        <p>Reports may be sent to
          <a href="mailto:[email protected]">[email protected]</a>.
          Include:
        </p>
        <ul>
          <li>The <code>service_did</code> of the listing in question
            (visible on the <a href="/">browse page</a>).</li>
          <li>The category above the report falls under.</li>
          <li>Evidence sufficient for the operator to make a
            reasonable determination — e.g., URLs, logs, screenshots,
            or a link to a third-party advisory.</li>
        </ul>
        <p>
          The operator will acknowledge receipt within a reasonable
          window and publish the outcome where relevant. Decisions
          are appealable by the listing controller, who is the entity
          that originally proved control of the discovery host
          (§4.1).
        </p>

        <h2>Re-claim by the legitimate controller</h2>
        <p>
          A controller whose listing has been soft-deleted or marked
          stale due to a hostile takeover of their discovery host
          may re-claim the listing by repeating the §4.1 challenge
          flow from the (recovered) host. A successful re-challenge
          revokes all prior session tokens for that listing.
        </p>

        <h2>Mirrors</h2>
        <p>
          Operational decisions made by the canonical directory do
          not bind mirrors or aggregators. A removal here may not
          propagate to mirrors that disagree with the determination;
          consumers depending on a specific take-down should consult
          the mirror or aggregator's own policy.
        </p>
      `,
    }),
  );
});
