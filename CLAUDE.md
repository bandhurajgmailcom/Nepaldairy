# Nepal Dairy NDS — CLAUDE.md

## Project Overview

**Nepal Dairy NDS (Nepal Dairy Shop)** is a full-stack business management and e-commerce web application built for a Nepalese dairy business. It handles internal operations (lab testing, sales tracking, user management) and a public-facing online shop with Nepali calendar (Bikram Sambat) integration.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (CommonJS) |
| Framework | Express.js v5 |
| Template Engine | EJS v5 |
| Database | SQLite (via `sqlite3`) — planned migration to PostgreSQL (`pg`) |
| Auth | `express-session` + `bcryptjs` (session-based, 8-hour timeout) |
| AI Integration | `@anthropic-ai/sdk`, `@ai-sdk/anthropic`, `ai` (Vercel AI SDK) |
| Static Assets | `/public` directory served by Express |

---

## Project Structure

```
nepaldairy/
├── app.js                  # Main entry point — Express setup, middleware, top-level routes
├── package.json
├── .env.local              # ANTHROPIC_API_KEY (never commit this)
│
├── db/
│   ├── database.js         # DB connection, schema creation, seed data
│   └── dairy.db            # SQLite database file (never commit this)
│
├── routes/
│   ├── auth.js             # GET/POST /login, GET /logout
│   ├── admin.js            # /admin/users, /admin/products (Administrator only)
│   ├── lab.js              # /lab — lab test recording (Lab + Administrator)
│   ├── sales.js            # /sales — sales recording (Sales + Administrator)
│   ├── pricelist.js        # /pricelist — NDS_PRICELIST management
│   ├── nepalical.js        # /admin/nepalical — Nepali calendar editor (Administrator only)
│   ├── shop.js             # /shop — public e-commerce (no login required)
│   └── orders.js           # /orders — order management (logged-in users)
│
├── views/
│   ├── layout.ejs          # Master layout (navbar, sidebar, footer)
│   ├── login.ejs
│   ├── dashboard.ejs
│   ├── profile.ejs
│   ├── calendar.ejs
│   ├── date-convert.ejs
│   ├── error.ejs
│   ├── admin/              # users.ejs, products.ejs, nepalical.ejs
│   ├── lab/                # index.ejs
│   ├── sales/              # index.ejs
│   ├── shop/               # home.ejs, products.ejs, cart.ejs, checkout.ejs, confirm.ejs
│   ├── orders/             # index.ejs (with pivot table analysis)
│   └── partials/           # Reusable template fragments
│
└── public/
    ├── style.css
    ├── logo.png
    ├── nepali-calendar.js      # BS/AD calendar calculation library
    ├── nepali-datepicker.js    # Nepali date picker widget
    └── css/shop.css
```

---

## Database Schema

All tables are in `db/dairy.db` (SQLite). Migration to PostgreSQL is planned.

### Internal Tables

```sql
users           -- id, username, password (bcrypt), role (Administrator|Lab|Sales), created_at
products        -- id, name, category, unit, price, created_at
lab_tests       -- id, product_id, test_date, fat, snf, moisture, result, notes, created_by, created_at
sales           -- id, product_id, quantity, unit, sale_date, customer, total_amount, created_by, created_at
```

### Shop / E-Commerce Tables

```sql
NDS_PRICELIST   -- ID, SN, PRODUCT, WHOLESALE, MRP, CATEGORY, SUBCATEGORY, UNIT, QTY, BARCODE, URL, DESCRIPTION
NDS_ORDERS      -- ID, ORDER_NO (unique), CUSTOMER_NAME, CUSTOMER_PHONE, CUSTOMER_ADDRESS,
                --   ORDER_DATE, BS_DATE, READY_DATE, PAYMENT_METHOD, PAYMENT_STATUS,
                --   ORDER_STATUS (New|Processing|Ready|Completed|Cancelled), TOTAL_AMOUNT, NOTES, created_at
NDS_ORDER_ITEMS -- ID, ORDER_ID, ORDER_NO, PRODUCT_ID, PRODUCT, CATEGORY, SUBCATEGORY,
                --   UNIT, QTY_PACK, QUANTITY, MRP, AMOUNT
```

### Nepali Calendar Tables

```sql
rnepalical      -- id, bs_year, bs_month (1-12), month_name, days, cumstartdays, cumdays
                --   UNIQUE(bs_year, bs_month). Seeded for BS years 2078-2083.
calendar_notes  -- id, bs_date (TEXT "YYYY-MM-DD" in BS), note, created_by, created_at, updated_at
```

### SQLite Trigger

```sql
trg_nepalical_days  -- Fires AFTER UPDATE OF days ON rnepalical
                    -- Recalculates cumstartdays and cumdays for the updated row
                    -- NOTE: subsequent rows are recalculated server-side via recalcCumDays()
```

---

## User Roles & Access Control

| Role | Access |
|---|---|
| **Administrator** | Everything — users, products, lab, sales, pricelist, orders, calendar editor |
| **Lab** | Lab tests + dashboard + read-only access |
| **Sales** | Sales recording + dashboard + read-only access |
| *(public)* | Shop browsing, cart, checkout — no login required |

Default seed credentials (change in production):
- `admin` / `admin123` (Administrator)
- `labuser` / `lab123` (Lab)
- `salesuser` / `sales123` (Sales)

---

## Key Routes

### Public (No Login)
| Route | Description |
|---|---|
| `GET /shop` | Shop home — category cards |
| `GET /shop/products?category=X&subcategory=Y` | Browse products |
| `POST /shop/cart/add` | Add to cart (AJAX, returns JSON) |
| `POST /shop/cart/update` | Update cart item quantity |
| `POST /shop/cart/remove` | Remove item from cart |
| `GET /shop/cart` | View cart |
| `GET /shop/checkout` | Checkout form |
| `POST /shop/place-order` | Place order |
| `GET /shop/order/:orderNo` | Order confirmation page |
| `GET /api/nepalical` | Returns BS calendar data as JSON |
| `GET /api/calendar-notes?year=&month=` | Returns calendar notes as JSON |

### Authenticated
| Route | Description |
|---|---|
| `GET /dashboard` | Dashboard with stats |
| `GET /profile` | User profile |
| `POST /profile/change-password` | Change own password |
| `GET /calendar` | Nepali BS calendar viewer |
| `GET /pricelist` | View/manage NDS price list |
| `GET /lab` | Lab tests |
| `GET /sales` | Sales records |
| `GET /orders` | Order management with pivot table |

### Admin Only
| Route | Description |
|---|---|
| `GET /admin/users` | User management |
| `GET /admin/products` | Product catalog management |
| `GET /admin/nepalical` | Nepali calendar data editor |

---

## Database Query Patterns

The app uses the `sqlite3` callback API throughout. All routes import `db` from `../db/database`.

```js
// Single row
db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => { });

// Multiple rows
db.all('SELECT * FROM products ORDER BY id', (err, rows) => { });

// Insert / Update / Delete
db.run('INSERT INTO products (name) VALUES (?)', [name], function(err) {
  const newId = this.lastID;   // available on INSERT
});

// Prepared statements (used in shop.js for bulk order item inserts)
const stmt = db.prepare('INSERT INTO table VALUES (?, ?)');
items.forEach(i => stmt.run(i.a, i.b));
stmt.finalize(() => { /* done */ });
```

**PostgreSQL migration note:** When migrating to `pg`, placeholders change from `?` to `$1, $2, $3`, `AUTOINCREMENT` becomes `SERIAL`, `INSERT OR IGNORE` becomes `INSERT ... ON CONFLICT DO NOTHING`, and `this.lastID` becomes `RETURNING id`.

---

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic AI API key | Yes |
| `SESSION_SECRET` | Express session secret | Yes (production) |
| `DATABASE_URL` | PostgreSQL connection string | Yes (after migration) |
| `PORT` | Server port (default: 3000) | No |
| `NODE_ENV` | Set to `production` on server | Recommended |

Store locally in `.env.local` — **never commit this file**.

---

## Running Locally

```bash
npm install
node app.js
# App runs at http://localhost:3000
```

There is no build step. The app is server-rendered via EJS — edit files and restart.

---

## Production Deployment (Railway)

**Target:** Railway.app + PostgreSQL + nepaldairy.com.np custom domain

### Pre-deployment checklist
- [ ] Add `"start": "node app.js"` to `package.json` scripts
- [ ] Change `PORT` to `process.env.PORT || 3000` in `app.js`
- [ ] Change session secret to `process.env.SESSION_SECRET` in `app.js`
- [ ] Migrate `db/database.js` from `sqlite3` to `pg`
- [ ] Update all route files: `?` → `$1,$2`, `db.get/all/run` → `pool.query`
- [ ] Add `pg` to dependencies, remove `sqlite3`
- [ ] Update `.gitignore` to exclude `dairy.db` and `.env.local`
- [ ] Push to GitHub
- [ ] Create Railway project, add PostgreSQL service
- [ ] Set env variables on Railway (`DATABASE_URL`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `NODE_ENV=production`)
- [ ] Connect `nepaldairy.com.np` domain via CNAME in Railway settings

**Estimated monthly cost:** ~$5 (Railway hobby plan covers one app + one PostgreSQL DB)

---

## Nepali Calendar Logic

- **Epoch:** BS 2078 Baishakh 1 = AD 2021-04-14 = cumulative day 1
- Calendar data is stored in `rnepalical` with cumulative day counters (`cumstartdays`, `cumdays`) for fast BS↔AD conversion
- `adToBs(dateStr, callback)` in `shop.js` converts AD date strings to human-readable BS format
- Client-side calendar rendering uses `/public/nepali-calendar.js` and `/public/nepali-datepicker.js`
- Calendar data is seeded for BS years 2078–2083; admin can add more years via `/admin/nepalical`

---

## Notes & Gotchas

- **Session cart** — the shopping cart lives entirely in `req.session.cart` (server-side session memory). It is cleared after order placement. Sessions are in-memory by default — restarting the server clears all active sessions and carts.
- **Order numbers** — generated as `NDS-YYYYMMDD-XXXX` (random 4-digit suffix). Not guaranteed unique under very high concurrency.
- **`next`, `react`, `react-dom`** in `package.json` are unused vestigial dependencies — safe to remove before production.
- **`@libsql/client`** is installed but not actively used — was likely intended for Turso (cloud SQLite). Can be removed.
- The `trg_nepalical_days` SQLite trigger only recalculates the **updated row**; subsequent rows are recalculated server-side. This trigger must be rewritten as a PostgreSQL trigger function during migration.
- All money values (prices, amounts) are stored as `REAL` (float) — be aware of floating point precision for financial calculations.
