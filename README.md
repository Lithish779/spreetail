# Flat 4B — Shared Expenses App

A shared-expenses tracker built for a flat-share of changing membership, with a focus on
**importing a messy real-world spreadsheet honestly** rather than silently cleaning it.

## Stack

- **Backend**: Node.js + Express, Sequelize ORM, SQLite (relational DB, file-based — easy to
  deploy without a separate DB server, but the schema is plain relational tables and would work
  identically on Postgres/MySQL).
- **Frontend**: React (Vite), React Router, plain CSS (no UI framework).
- **Auth**: JWT-based, bcrypt password hashing.

## AI & Documentation Files

This project contains several core documentation files mapping out the development scope, decisions, and AI assistance:
1. **[README.md](file:///c:/Users/lithi/Downloads/flat4b-expenses/expenses-app/README.md)**: Main setup and run instructions.
2. **[SCOPE.md](file:///c:/Users/lithi/Downloads/flat4b-expenses/expenses-app/SCOPE.md)**: Details the database schema and is an anomaly log mapping every data problem found in the CSV (20 distinct types) and how the importer resolves them.
3. **[DECISIONS.md](file:///c:/Users/lithi/Downloads/flat4b-expenses/expenses-app/DECISIONS.md)**: Decision log explaining architectural trade-offs, time-bounded memberships, fixed exchange rates, rounding, and settlements.
4. **[import_report.md](file:///c:/Users/lithi/Downloads/flat4b-expenses/expenses-app/import_report.md)**: The parsed output and actions taken for each row of the ingested spreadsheet, matching the live import report UI.
5. **[AI_USAGE.md](file:///c:/Users/lithi/Downloads/flat4b-expenses/expenses-app/AI_USAGE.md)**: Explains the AI tools used, prompts, and details three concrete errors the AI made and how they were caught/corrected.

---

## AI Collaboration Summary

The primary AI collaborator used was **Claude (Gemini/Anthropic)** via agentic tool interfaces. 
During the pairing, three concrete errors were identified and corrected:
1. **Ambiguous Date Over-triggering**: Claude originally flagged all dates with day and month $\le 12$ as ambiguous. This was corrected to only flag lines where the row's `notes` column explicitly indicates date ambiguity.
2. **Stopword and Phrase Differences in Duplicate Detection**: The initial duplicate-check logic used direct description string matching, missing rows like `"Dinner at Marina Bites"` and `"dinner - marina bites"`. This was corrected by adding a secondary fingerprinting function that strips stopwords ("at", "the", etc.) and sorts significant words alphabetically.
3. **Sandbox Dependency Download Restriction**: Native compilation for `sqlite3` failed in the sandboxed environment because downloading Node headers was blocked. This was resolved by pointing the installer to the local sandbox node directory path.

For full prompts and directing details, see **[AI_USAGE.md](file:///c:/Users/lithi/Downloads/flat4b-expenses/expenses-app/AI_USAGE.md)**.

---

## Project Structure

```
backend/
  src/
    models/index.js       # Sequelize models + associations (schema)
    routes/               # auth, groups, expenses, import
    utils/
      splitCalculator.js  # core split-type math (equal/unequal/percentage/share)
      csvImporter.js      # anomaly detection + normalization for the CSV import
    seed.js               # creates demo group "Flat 4B" + 6 users with membership history
    index.js              # Express entrypoint
frontend/
  src/
    pages/                # Login, GroupsList, GroupDetail
    components/           # MembersTab, ExpensesTab, BalancesTab, SettlementsTab, ImportTab
    api.js                # fetch wrapper
```

---

## Running Locally

You can run the frontend and backend together using the root monorepo scripts or individually.

### Option A: Monorepo Root Script (Recommended)
From the root directory (`expenses-app`):

1. **Install and Build**:
   ```bash
   npm run build
   ```
   *This installs dependencies for both backend and frontend, and builds the frontend assets.*

2. **Start Backend & Frontend together**:
   ```bash
   npm start
   ```
   *Runs the server on http://localhost:4001, hosting the frontend statically.*

---

### Option B: Running Individually

#### 1. Backend
From `backend/`:
```bash
cd backend
npm install
npm run seed     # creates data/expenses.sqlite with demo group + 6 users
npm start        # runs on http://localhost:4001
```
*Demo accounts (password: `password123`): `aisha@example.com`, `rohan@example.com`, `priya@example.com`, `meera@example.com`, `dev@example.com`, `sam@example.com`.*

#### 2. Frontend
From `frontend/`:
```bash
cd frontend
npm install
npm run dev      # runs on http://localhost:5173, proxies /api to port 4001
```

---

## Importing the CSV

1. Log in as any current member of "Flat 4B" (e.g. Aisha).
2. Open the group → **Import CSV** tab.
3. Upload `Expenses Export.csv` from your Downloads folder.
4. Review the anomaly report — every detected issue, what was done about it, and why.
5. Click **Approve and apply** to write the expenses/settlements to the database, or **Reject** to discard.

Nothing is written to the database between upload and approval.

---

## Environment Variables

`backend/.env` (optional):
```
PORT=4001
JWT_SECRET=dev-secret-flat4b-token-signing-key-9988
SQLITE_STORAGE=data/expenses.sqlite
USD_TO_INR_RATE=84
```

---

## Deployment

* **Backend**: Node.js host (Render, Railway, Fly.io). Persist `backend/data/expenses.sqlite` on a volume.
* **Frontend**: Static site build from `frontend/dist/` (Vercel, Netlify) or served directly by the backend Express instance.

