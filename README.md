# Asset Manager

A simple, clean web-based asset management tool.  
**Stack:** Node.js · Express · SQLite (via sql.js — pure WebAssembly, no native build)

---

## Project Structure

```
asset-manager/
├── server.js          ← Express entry point — mounts routes and static files
├── db.js              ← SQLite setup, schema creation, seed data
├── validation.js      ← Shared input validation
├── jira.js            ← Optional Jira repair-issue sync (opt-in via env vars)
├── routes/
│   └── assets.js      ← REST API: GET / POST / PUT / DELETE
├── public/
│   └── index.html     ← Full frontend (HTML + CSS + vanilla JS)
├── package.json
└── assets.db          ← Created automatically on first run
```

---

## Setup

### Prerequisites
- Node.js 18 or later

### 1. Install dependencies

```bash
npm install
```

### 2. Start the server

```bash
npm start
```

The SQLite database (`assets.db`) is **created automatically** with 6 sample assets on first run — no migration step needed.

### 3. Open the app

```
http://localhost:3000
```

### Development (auto-restart on save)

```bash
npm run dev
```

---

## API Reference

| Method | Endpoint      | Description                                          |
|--------|---------------|------------------------------------------------------|
| GET    | `/assets`     | List assets — supports `?search=` and `?status=`    |
| GET    | `/assets/stats` | Total asset count + count per status (sidebar tally) |
| POST   | `/assets`     | Create a new asset                                   |
| PUT    | `/assets/:id` | Update an existing asset                             |
| DELETE | `/assets/:id` | Delete an asset                                      |
| GET    | `/config`     | Frontend config (Jira base URL for ticket deep-links) |

### Query Parameters (GET)

| Param    | Example                  | Searches / Filters                          |
|----------|--------------------------|---------------------------------------------|
| `search` | `?search=apple`          | name, category, company, serial #, assigned_to |
| `status` | `?status=In+Repair`      | Exact status match                          |

Both can be combined: `GET /assets?search=laptop&status=Available`

### Asset Fields

| Field           | Required | Type   | Valid Values                                        |
|-----------------|----------|--------|-----------------------------------------------------|
| `name`          | ✓        | string | Any non-empty string                                |
| `category`      | ✓        | string | Laptop, Monitor, Phone, Tablet, Printer, Server, Keyboard, Mouse, Other |
| `status`        | ✓        | string | Available, Assigned, In Repair, Ordered, Pending Approval, Retired |
| `company`       |          | string | Free text (Apple, Dell, HP, …)                     |
| `serial_number` |          | string | Free text                                           |
| `assigned_to`   |          | string | Employee name                                       |
| `purchase_date` |          | string | YYYY-MM-DD                                          |
| `notes`         |          | string | Free text                                           |

### Example: Create an asset

```bash
curl -X POST http://localhost:3000/assets \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MacBook Pro 14",
    "category": "Laptop",
    "status": "Available",
    "company": "Apple",
    "serial_number": "C02XL0LFJGH5",
    "assigned_to": "",
    "purchase_date": "2024-01-15",
    "notes": "Company standard issue"
  }'
```

---

## Jira integration (repair tracking)

Optionally, the app can mirror assets that are **In Repair** into an existing
Jira project. When an asset's status is `In Repair`, a Jira issue is created
(or, if one already exists for that asset, updated). Closure is **manual** —
the integration never transitions or closes issues, so your team resolves the
repair in Jira when it's done.

**When the Jira issue is closed**, a background poller notices (within
`JIRA_POLL_INTERVAL_MS`, default 5 min) and automatically reverts the asset to
the status it held *before* the repair (e.g. back to `Assigned`), then clears
the open-ticket link. Assets created directly as `In Repair` revert to
`Available`. Every ticket ever opened for an asset is recorded in its
`repair_ticket_history` field, so the full repair trail survives closures.

The integration is **opt-in and best-effort**: if the env vars below aren't
set it stays disabled, and if Jira is unreachable the failure is logged but the
asset still saves normally.

### Enable it

1. Create an API token at
   <https://id.atlassian.com/manage-profile/security/api-tokens>.
2. Copy `.env.example` to `.env` and fill in:

   | Variable           | Example                              | Notes                                  |
   |--------------------|--------------------------------------|----------------------------------------|
   | `JIRA_BASE_URL`    | `https://acme.atlassian.net`         | Your Jira Cloud site                   |
   | `JIRA_EMAIL`       | `you@acme.com`                       | Account the token belongs to           |
   | `JIRA_API_TOKEN`   | `ATATT3x…`                           | The API token from step 1              |
   | `JIRA_PROJECT_KEY` | `REP`                                | Key of your existing Repairs project   |
   | `JIRA_ISSUE_TYPE`  | `Task`                               | Optional; defaults to `Task`           |
   | `JIRA_POLL_INTERVAL_MS` | `300000`                        | Optional; close-detection poll interval, default 5 min |

3. `npm start` (the start script auto-loads `.env` when present).

A console line on boot confirms the state: `Jira sync disabled` vs. created/
updated issue keys as assets enter repair. The created issue's key is stored on
the asset (`jira_issue_key`) so subsequent edits update the same issue.

---

## Resetting the database

Delete `assets.db` and restart — it will be recreated with fresh seed data:

```bash
rm assets.db && npm start
```

## Custom port

```bash
PORT=8080 npm start
```
