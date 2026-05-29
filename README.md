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

## Resetting the database

Delete `assets.db` and restart — it will be recreated with fresh seed data:

```bash
rm assets.db && npm start
```

## Custom port

```bash
PORT=8080 npm start
```
