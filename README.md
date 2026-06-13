# Flat 4B — Shared Expenses App

A shared-expenses tracker built for a flat-share of changing membership, with a focus on
**importing a messy real-world spreadsheet honestly** rather than silently cleaning it.

## Stack

- **Backend**: Node.js + Express, Sequelize ORM, SQLite (relational DB, file-based — easy to
  deploy without a separate DB server, but the schema is plain relational tables and would work
  identically on Postgres/MySQL).
- **Frontend**: React (Vite), React Router, plain CSS (no UI framework).
- **Auth**: JWT-based, bcrypt password hashing.

## AI used

Claude (Anthropic), via the Claude.ai chat interface with code-execution/file-creation tools.
See `AI_USAGE.md` for prompts, what it got wrong, and what was changed.

## Project structure

```
backend/
  src/
    models/index.js       # Sequelize models + associations (schema)
    routes/                # auth, groups, expenses, import
    utils/
      splitCalculator.js   # core split-type math (equal/unequal/percentage/share)
      csvImporter.js        # anomaly detection + normalization for the CSV import
    seed.js                # creates demo group "Flat 4B" + 6 users with membership history
    index.js               # Express entrypoint
frontend/
  src/
    pages/                 # Login, GroupsList, GroupDetail
    components/            # MembersTab, ExpensesTab, BalancesTab, SettlementsTab, ImportTab
    api.js                 # fetch wrapper
```

## Running locally

### Backend

```bash
cd backend
npm install
npm run seed     # creates data/expenses.sqlite with demo group + 6 users
npm start        # runs on http://localhost:4000
```

> Note: `sqlite3` has a native binding. If `npm install` fails to fetch a prebuilt binary for
> your platform, run `npm_config_nodedir=/path/to/node/headers npx node-gyp rebuild` inside
> `node_modules/sqlite3` (most CI/deploy platforms fetch prebuilds automatically and this is not
> needed).

Demo accounts (all password `password123`):
`aisha@example.com`, `rohan@example.com`, `priya@example.com`, `meera@example.com`,
`dev@example.com`, `sam@example.com`.

### Frontend

```bash
cd frontend
npm install
npm run dev      # runs on http://localhost:5173, proxies /api to :4000
```

### Importing the CSV

1. Log in as any current member of "Flat 4B" (e.g. Aisha).
2. Open the group → **Import CSV** tab.
3. Upload `expenses_export.csv` (unmodified).
4. Review the anomaly report — every detected issue, what was done about it, and why.
5. Click **Approve and apply** to write the expenses/settlements to the database, or **Reject**
   to discard the import entirely without writing anything.

Nothing is written to the database between upload and approval — this satisfies Meera's request
to review anything the app changes before it happens.

## Environment variables

`backend/.env` (optional):
```
PORT=4000
JWT_SECRET=replace-with-a-real-secret-in-production
```

## Deployment

- Backend: any Node host (Render, Railway, Fly.io). Persist `backend/data/expenses.sqlite` on a
  volume, or point Sequelize at a managed Postgres instance (the models use no SQLite-specific
  features).
- Frontend: `npm run build` produces `frontend/dist/`, deployable as a static site (Vercel,
  Netlify, or served by the backend itself).
