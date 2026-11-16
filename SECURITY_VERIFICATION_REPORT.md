# EventHub Security Verification

## Verified in this work

- Database credentials were not printed, added to frontend code, or copied into tracked configuration. The ignored local `.env` was left unchanged.
- Neon connections are server-side, use the PostgreSQL driver, TLS, and bounded connection pooling. The isolated test environment is separate from production.
- New vendor-list filter values are parameterized; sort SQL is chosen from fixed allowlisted fragments. User-supplied values are not interpolated into SQL identifiers or ordering clauses.
- Public vendor results remain constrained to verified vendors with active user accounts. Existing route validation and media-owner scoping integration tests passed in the isolated-Neon marketplace suite.
- Authentication/authorization unit tests ran as part of the backend suite. The default suite completed with 541 passed, 0 failed, and 28 opt-in Neon tests skipped; the full opt-in suite passed 590/590. A regression test also confirms the PostgreSQL admin middleware does not retry an expired session using legacy `?`-placeholder SQL.
- No production database, deployment, or GitHub push was accessed.

## Not certified

- This was not a penetration test or a complete security review of all 1,255 query call sites.
- The inventory has 566 `NEEDS_FIX` and 654 `UNVERIFIED` application call sites. Authorization coverage for all routes and roles is not established by this report.
- Production secret storage, Netlify/Render access policies, production CORS origins, external SMTP delivery, rate-limit behavior under load, and deployed TLS/security headers were not independently inspected.
- No production authentication, authorization, payment, or data-retention behavior was tested.

Continue using least-privilege database credentials, secret-manager environment variables, and parameterized SQL. Resolve the call-site inventory before asserting full application security or PostgreSQL compatibility. See [SECURITY_FINAL_VERIFICATION.md](./SECURITY_FINAL_VERIFICATION.md) for the current focused verification.
