# AgentPay Guard — Next.js app

Single Next.js application: UI pages + `/api/v1` route handlers (docs/02, docs/06, docs/07).

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm test       # Vitest unit tests
pnpm typecheck  # tsc --noEmit
pnpm lint
pnpm build
```

Environment: copy `../.env.example` to `.env.local` (never commit it). Project docs live in `../docs` and `../README.md`.
