# EventHub Deployment Status

## Configuration

- Render: `render.yaml`
- Netlify: `netlify.toml`
- Frontend publish directory: `frontend/dist`
- Backend start command: `npm run start`
- Backend readiness path: `/api/ready`
- Runtime: Node 20
- Database: Neon PostgreSQL only

## Local verification

Run:

```sh
npm run db:check
npm test
npm run build
```

Additional deployment checks:

```powershell
.\scripts\check-deploy.ps1 -RenderUrl "https://<confirmed-render-service>.onrender.com"
```

## Production secrets

Do not place Neon credentials, OAuth secrets, SMTP credentials, AI keys, or payment secrets in tracked files or logs. Configure them in the Render, Netlify, or local environment provider. Existing `.env.example` files preserve variable names without real values.

## Current status

Repository structure and deployment configuration are organized. Live Render/Netlify availability and a production database connection require environment credentials and a confirmed deployed hostname, so they cannot be asserted solely from the local workspace.

Validation completed locally:

- Neon PostgreSQL runtime: PASS.
- Backend suite: PASS, 568 tests.
- Frontend production build: PASS.
- Frontend suite: 235 passed, 0 failed.
