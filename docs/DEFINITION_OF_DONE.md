# Definition of Done

A story is Done when **all** of the following hold. "Mostly done" is not done; it goes back on
the board.

## Code
- [ ] Behaviour implemented and reachable from the API (or UI) — no dead code paths.
- [ ] Input validated at the boundary; invalid input returns `400` with a field-level message.
- [ ] Authorisation enforced **server-side**. A client-side role check is never the only gate.
- [ ] No dialect-specific SQL. If it will not run on both SQLite and Postgres, it does not merge
      (see ADR-0001).
- [ ] Errors go through the shared error handler; no stack traces leak to clients in production.

## Tests
- [ ] Happy path covered by an automated test.
- [ ] At least one failure/permission path covered (403/409/400 as relevant).
- [ ] `npm test` is green locally before the PR opens.

## Data & privacy
- [ ] Nothing captured is stored that the story did not explicitly require.
- [ ] Any admin read of screenshots or audio writes an `audit_logs` row.
- [ ] Retention rule still holds: files purge at 31 days, metadata rows are retained.

## Documentation
- [ ] New/changed endpoints listed in `backend/API.md`.
- [ ] Any new environment variable added to `.env.example` with a comment.
- [ ] A decision that constrains future work is written up as an ADR.

## Review
- [ ] Reviewed by someone who did not write it.
- [ ] Demoable at sprint review from a clean `db:reset`.
