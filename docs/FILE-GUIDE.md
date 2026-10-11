# DIVYA file guide

| Path | Responsibility |
| --- | --- |
| `frontend/index.html` | Complete dashboard, inline CSS and browser JavaScript, maps and API polling |
| `backend/server.js` | Express app, login/logout, signed session cookies, role checks, fault handling, work orders, tickets, reports and MongoDB persistence |
| `server.js` | Root compatibility entry point for npm and Vercel; exports the backend app |
| `data/modules.json` | Default registered grid modules |
| `data/engineers.json` | Default engineer records |
| `data/runtime.json` | JSON fallback activity, work orders and tickets; local testing can modify this file |
| `scripts/setup-mongodb.ps1` | Writes root `.env`, installs dependencies and starts the app from the root |
| `docs/DIVYA-System.pdf` | Existing project document |
| `docs/screenshots/grid-console.jpeg` | Existing reference image |
| `.env.example` | Environment-variable names and placeholder values |
| `package.json`, `package-lock.json` | npm scripts and dependency versions |
| `vercel.json`, `render.yaml` | Existing hosting configuration |
| `CHANGELOG.md` | Project change history |

The existing `Divya-System` Git submodule entry is retained without changes. It is not the active frontend or backend; use the folders above for current development.

## Paths after reorganization

The backend resolves `.env`, seed data and fallback data from the repository root, and serves `frontend/index.html` at `/`. The root entry point remains discoverable by the existing deployment setup. The PowerShell setup script resolves its parent directory as the project root.
