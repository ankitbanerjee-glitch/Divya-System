# Contributing to DIVYA

## Pick your work area

Use the [README file map](README.md#where-do-i-work) and [detailed file guide](docs/FILE-GUIDE.md). Frontend work goes in `frontend/index.html`; API, authentication and database code go in `backend/server.js`. Coordinate before editing the same file because both areas currently use a single large file.

## Develop on a branch

From the repository root:

```bash
git switch main
git pull --ff-only
git switch -c frontend/your-feature
npm ci
npm start
```

Use descriptive branch names such as `frontend/dashboard-layout`, `backend/fault-api`, `data/module-update` or `docs/setup-guide`. Open http://localhost:3000. To configure MongoDB, follow the README. Local development can use JSON fallback storage; do not commit runtime changes from manual testing.

## Check and submit

1. Run `npm run check`.
2. Verify the dashboard loads, sign in with the relevant roles and exercise the behavior you changed.
3. Check `git diff` for accidental data changes or credentials.
4. Commit and push your feature branch, then open a pull request to `main`.
5. Describe the change and verification; request review from the repository owner before merging.

Keep `.env`, database passwords, session secrets and API keys out of commits. Change `.env.example` only with placeholders. Branch protection is managed in GitHub settings; this guide does not enforce it.
