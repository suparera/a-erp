# A-ERP: learning to build an ERP with agentic coding

A-ERP is a **learning project**: an exploration of how far you can get building an ERP (Enterprise Resource
Planning) system by **directing an AI coding agent** instead of writing every line by hand. The author
describes each step in plain language, and the agent ([Claude Code](https://claude.com/claude-code))
does the work: it plans, writes the code, runs it, checks the result in a browser, and reports back.
The author reviews each step and decides the next one.

The goal is to learn the *workflow*, not to ship a production ERP:
- how to break a large system into steps an agent can carry out,
- how to give it context (data, design rules, constraints),
- how to verify what it produces,
- and where a human still has to make the call.

> ⚠️ **Prototype with synthetic data.** All companies, people and figures are fictional. Not for real
> accounting or business use.

## What the project contains

A working ERP prototype for a fictional Thai distributor, **A-Pro Distribution Co., Ltd.**, which sells
hardware and building materials from 3 warehouses (Bangkok, Chiang Mai, Khon Kaen) to retail shops,
contractors and wholesalers:

1. **Synthetic dataset** (`src/erp_synth/`): a day-by-day business simulation, not random rows. Stock-outs
   trigger purchase orders, deliveries draw down stock at moving-average cost, and every financial event
   posts a balanced journal entry. Sub-ledgers reconcile to the general ledger.
2. **API** (`src/erp_api/`): a read-only FastAPI JSON API over the SQLite data.
3. **Web app** (`web/`): a React app with dashboard, sales, customers, receivables, inventory, purchasing
   and accounting pages.
4. **Sign-in**: Supabase Auth with server-side session validation and Postgres row-level security.

## How it was built: the agentic-coding journey

Each step started as a short instruction to the agent. The agent then did the work end to end and the
author reviewed the result.

| # | Instruction (paraphrased) | What the agent did | What it taught |
|---|---|---|---|
| 1 | *"Initial project: start from a synthetic dataset"* | Chose sensible defaults (Thai distributor, THB, 7% VAT), wrote a day-by-day simulation with GL postings, ran it, noticed unrealistic results (90% of revenue from one segment, negative cash, 1-line POs), and re-tuned until every integrity check passed | Ask for **self-checks**: the agent's own validations caught bad data that looked fine at a glance |
| 2 | *"Run server"* | No app existed yet, so it served the database with an off-the-shelf data browser (Datasette) as a stopgap | A vague instruction gets a reasonable interpretation, so say which outcome you actually want |
| 3 | *"Change frontend to React; install the ui-ux-pro-max skill"* | Read the third-party skill before installing it, kept only the safe core part, generated a design system with it, built the API and React app, then checked every page in a real browser (desktop, mobile, light and dark) and fixed what it saw | **Verify visually.** Screenshots caught clipped columns, an overflowing table and a runtime error that type checks missed |
| 4 | *"Add login using Supabase (see .env.local)"* | Read the config without printing secrets, queried the project's auth settings, verified sign-in tokens on the API (not just in the UI), and wrote tests | Secure the **server**, not only the screen. A login page alone protects nothing |
| 5 | *"Give a testing account"* | Explained that email confirmation blocked it, and listed the options instead of working around it | A good agent **stops and explains a real blocker** instead of faking success |
| 6 | *"Change to SQLite"* | Replaced Supabase with local accounts (hashed passwords, cookie sessions, rate limiting), added a user-admin CLI, created a test account, and tested sign-in and sign-out end to end | Changing direction is cheap when each step is small and tested |
| 7 | *"Commit generated CSVs; publish to GitHub"* | Fixed a `.gitignore` rule that silently didn't work, scanned for secrets, kept the database files with password hashes out of the repo | Review **what becomes public** before every push |

### Lessons for agentic coding

- **Small, outcome-focused steps** beat one giant spec. Each step above was one or two sentences.
- **Let the agent verify its own work**: integrity checks, unit tests, type checks, and real-browser screenshots.
- **Give it tools and context**: current library docs, a design-system skill, and the browser it can drive.
- **Keep the human on decisions**: scope, trade-offs, what goes public, and when something is "good enough".
- **Watch secrets and side effects**: the agent masked keys, kept password hashes out of git, and
  asked before outward-facing actions.

## Quick start

```bash
uv run python -m erp_synth generate            # → data/erp.sqlite (+ data/csv/*.csv, data/ground_truth/*.csv)
uv run python -m erp_synth validate            # re-run integrity checks + summary
uv run python -m unittest discover -s tests    # smoke tests (integrity + determinism)

# options
uv run python -m erp_synth generate --seed 7 --start 2024-01-01 --end 2026-10-31 --customers 600 --orders-per-day 30
```

The generator uses only the Python standard library (3.11+). The same seed always gives byte-identical output.
The CSV export (`data/csv/`) is committed so you can explore the data without running anything. The SQLite
database and ground-truth files are generated locally.

## Run the app (React frontend + API)

```bash
uv run python -m erp_synth generate                                  # once: build data/erp.sqlite
uv run uvicorn erp_api.app:app --env-file .env.local --reload --reload-dir src --port 8010  # terminal 1: JSON API
cd web && npm install && npm run dev                                 # terminal 2: React dev server (port 5180)
# → http://127.0.0.1:5180   (Vite proxies /api to :8010; override with ERP_API=http://host:port)
```

Single-port mode: `cd web && npm run build` creates `web/dist`. The API then serves the app at
http://127.0.0.1:8010 (restart uvicorn after the first build). Ports 8000 and 5173 are avoided
because they're often taken by OrbStack/Docker.

## Run the Next.js starter

`web-next/` is the Next.js App Router starter with a sign-in page and a protected dashboard.
It shares FastAPI and Supabase Auth with the React frontend and runs without the synthetic ERP dataset.

Set the following in the ignored `.env.local` file at the repository root. Get the publishable key from
the [Supabase project API keys page](https://supabase.com/dashboard/project/tktcuflqokgssrrbjnyg/settings/api-keys).

```dotenv
SUPABASE_URL=https://tktcuflqokgssrrbjnyg.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
```

Apply the migrations when setting up a new Supabase project, import
`data/csv/employees.csv` into `public.employees`, and turn off **Allow new users to sign up**
in the hosted Auth settings. Start FastAPI from the repository root.

```bash
uv run uvicorn erp_api.app:app --env-file .env.local --reload --reload-dir src --port 8010
```

Start Next.js in a second terminal with Node.js 20.9 or later.

```bash
npm --prefix web-next ci
npm --prefix web-next run dev
```

Open http://127.0.0.1:3000. Set `ERP_API` in the Next.js server environment if FastAPI uses a
different host or port. Use the same hostname for both frontends to share the browser session.

### Supabase accounts and access

An administrator provisions accounts in Supabase Authentication with the employee's roster email.
The database matches the email to `public.employees` after trimming spaces and ignoring case.
Each employee can have one account, and the employee must be active when the account is created.
Confirm that the employee controls the email address before marking it verified. Grant ERP access
in the Supabase SQL Editor using the Auth user ID. The default ERP role is `user`.

```sql
insert into public.aerp_memberships (user_id) values ('user-uuid-from-supabase-auth');
```

Users can sign in with their employee email. If `ERP_USERNAME_DOMAIN` matches the domain of the
employee's email, they can also sign in with the part before `@`.

Login, token refresh, and every protected API request require a verified email, a live Supabase
session, and an ERP membership for the linked employee. Update employment status in
`public.employees` in Supabase. Access ends on the next protected request after `is_active`
changes to `0`, or from midnight in Bangkok on the `termination_date`. A future termination date
allows access while `is_active = 1`. Store termination dates in `YYYY-MM-DD` format and use
`NULL` when there is no termination date. If an employee's email changes, update the roster and
the linked account for the same employee. Existing accounts with unmatched emails must be linked
to an eligible employee by updating and verifying the account email before they can access ERP.

Supabase handles passwords. The app stores access and refresh tokens in `HttpOnly`, `SameSite=Lax`
cookies. Set `ERP_COOKIE_SECURE=1` when serving over HTTPS. For local Supabase development, run
`supabase start` and use the local API URL and publishable key.

The app treats the dataset's last posting date (**31 Oct 2026**) as "today", so ageing, YTD and DSO
figures are meaningful. The API is **read-only** for now, and every data endpoint requires sign-in.

| Page | What it shows |
|---|---|
| Dashboard | YTD KPIs, monthly revenue / gross margin, AR ageing, revenue by segment and category, top customers |
| Sales Orders | Filterable list → detail with document flow (order → delivery → invoice → payment), lines, GL postings |
| Customers | List with YTD revenue / open AR → detail with payment behaviour, credit utilisation, open invoices |
| Receivables | Ageing buckets (click to filter) and open invoices by days overdue |
| Inventory: Dashboard | Stock value trend by warehouse, days of cover, turns, fill rate, warehouse comparison, ABC × cover heatmap (click to drill in), items needing attention (cover vs supplier lead time, incoming stock), slow/dead and overstock, movements, top shrinkage |
| Inventory: Stock list | Stock by item × warehouse vs. reorder point → product detail with price history and stock movements |
| Purchasing | PO list → detail with requisition & approval, each delivery (rejections), three-way match per invoice (hold reasons, variances), payment, GL postings |
| Accounting | Trial balance, monthly income statement (THB '000), account ledger with running balance |

Stack: React 19, TypeScript, Vite, Tailwind CSS v4, React Router, TanStack Query, Recharts, Lucide icons.
Filters, sorting and paging live in the URL, so every view can be linked and survives Back.
The design follows the `ui-ux-pro-max` skill (`.claude/skills/ui-ux-pro-max`). Its "Minimalism & Swiss"
system uses navy and slate with a blue accent, and is defined as semantic tokens in `web/src/index.css`.
Light and dark modes follow the OS.

## What you get (default seed 42, 2025-01-01 → 2026-10-31)

| Area | Tables (rows ≈) |
|---|---|
| Org | `company`, `departments` (7), `employees` (61) |
| Master | `warehouses` (3), `product_categories` (7), `products` (220), `product_prices` (price/cost history), `inventory_policies` (660 item×warehouse), `customers` (400), `suppliers` (28), `chart_of_accounts` (17) |
| Order-to-cash | `sales_orders` (14k), `sales_order_lines` (58k), `deliveries`, `sales_invoices`, `customer_payments` |
| Sourcing | `supplier_products` (539: 2–4 suppliers per product with price, lead time, MOQ, preferred flag), `rfqs` (250), `rfq_quotes` (598) |
| Procure-to-pay | `purchase_requisitions` (3.9k) + lines, `purchase_orders` (3.9k), `purchase_order_lines`, `goods_receipts` (4.3k, with split deliveries), `goods_receipt_lines` (with rejections), `supplier_invoices` (4.2k, with three-way match), `supplier_invoice_lines`, `supplier_payments` |
| Inventory | `inventory_transactions` (65k — OPENING / RECEIPT / SHIPMENT / ADJUSTMENT, signed qty & cost) |
| GL | `journal_entries` (57k), `journal_lines` (134k) |

Headline P&L: about 170M THB revenue in 2025, about 27% gross margin, 6–11% EBIT. The full DDL is in
[`src/erp_synth/schema.sql`](src/erp_synth/schema.sql).

## Business flows simulated

```
Sales order ──(stock available at customer's warehouse)──▶ Delivery ─▶ Sales invoice ─▶ Customer payment(s)
     │  not available → backorder; cancelled after 30 days                                (behaviour-driven delay)
     ▼
Stock position (on hand + on order + on requisition − backlog) < reorder point
  ──(preferred supplier's weekly review day, other low items topped up)──▶ Purchase requisition
  ──(approval by amount)──▶ Purchase order ──▶ Goods receipt(s) ──▶ Supplier invoice ──(three-way match)──▶ Payment
       out of stock with nothing on order → EMERGENCY requisition to the fastest supplier, approved same day
```

### Procurement in detail (for procurement demos)

| Stage | What the data contains |
|---|---|
| **Supplier price list** | Every product has a preferred supplier plus 1–3 alternates (`supplier_products`): own price, lead time and minimum order quantity |
| **Sourcing (RFQs)** | About 2–3 RFQs a week invite the current suppliers, sometimes a newcomer. Quotes are scored on price × lead time × each supplier's *actual* on-time history. The winner becomes the preferred supplier at the quoted price, which changed the preferred supplier for 100+ products |
| **Requisitions & approvals** | Each PO starts as a requisition. Under ฿50k → auto-approved. ฿50k–300k → Purchasing Manager (1–3 days). Over ฿300k → Managing Director (2–6 days). About 1.5% are rejected with a reason. At the end date some requisitions are still pending approval |
| **Purchase orders** | About 2.2 lines per PO (low items from the same supplier and warehouse are consolidated). Prices come from the supplier price list. Status: `OPEN`, `PARTIALLY_RECEIVED`, `RECEIVED` or `CLOSED_SHORT` |
| **Receiving** | 12% of POs arrive in 2 deliveries. Short shipments and dock rejections (damaged or wrong goods, with reasons) follow the supplier's profile. Only accepted units enter stock |
| **Three-way match** | Each delivery is invoiced separately and matched: billed qty × price vs accepted qty × PO price. Suppliers sometimes bill rejected units, over-bill quantity, or charge above the PO price. Within tolerance (≤1% price, ≤฿1,000) → auto-approved. Otherwise → `ON_HOLD` for 3–20 days, then the supplier corrects it or the buyer accepts the variance (posted to **5200 Purchase Price Variance**) |
| **Payables** | AP is posted only when an invoice is approved, so on-hold invoices sit in GRNI (2150) until resolved. Payment follows each supplier's terms |

**Supplier reliability (hidden profile → visible outcomes):**

| Profile | Suppliers | On-time first delivery | POs closed short | Invoices with exceptions |
|---|---|---|---|---|
| reliable | 14 | ~95% | ~5% | ~8% |
| average | 11 | ~84% | ~14% | ~16% |
| unreliable | 3 | ~58% | ~28% | ~32% |

Overall on-time delivery is about 88%. The profiles are in `data/ground_truth/supplier_reliability.csv`, so a
supplier-scorecard or risk model can be checked against the truth. Procurement uses its own random stream,
so changing procurement settings never changes customer demand.

Realism built in:
- **Demand:** 12% yearly growth; Thai seasonality (April Songkran dip, rainy-season slowdown, dry-season peak); half-day Saturdays; closed on Sundays and public holidays; Pareto-distributed customer volumes; new customers acquired and others churned during the period.
- **Pricing:** list price and cost both rise on 2026-01-01 (`product_prices`); segment discounts (contractor 4%, wholesale 8%) plus occasional 5% promotions; PO costs vary ±3% around standard cost.
- **Products:** some launched mid-period, some discontinued.
- **Inventory:** moving-average costing; monthly cycle-count adjustments (mostly shrinkage).
- **AR:** payment behaviour varies by customer (prompt, normal, slow, late, defaulter); some invoices are paid in 2 instalments; cash customers pay on the invoice date.
- **People:** employees are hired and terminated over time; payroll includes 5% employer social security, capped at 750 THB.

## GL posting rules

| Event | Debit | Credit |
|---|---|---|
| Opening balances | 1000 Cash, 1200 Inventory | 3000 Share Capital, 3100 Retained Earnings |
| Delivery (COGS) | 5000 COGS | 1200 Inventory |
| Sales invoice | 1100 AR | 4000 Revenue, 2100 Output VAT |
| Customer payment | 1000 Cash | 1100 AR |
| Goods receipt | 1200 Inventory | 2150 GRNI |
| Supplier invoice (at approval) | 2150 GRNI (receipt value), 1150 Input VAT, 5200 PPV (if accepted variance) | 2000 AP |
| Supplier payment | 2000 AP | 1000 Cash |
| Cycle count | 5100 Shrinkage / 1200 | 1200 / 5100 |
| Payroll, rent, utilities (month end) | 6000/6010/6100/6200 | 1000 Cash |
| VAT return PP.30 (15th of next month) | 2100 Output VAT | 1150 Input VAT, 1000 Cash (net) |

`journal_entries.source_type` + `source_id` link each entry back to its source document.

## Integrity checks (run on every generate)

These checks run on every `generate`: foreign keys; every journal entry balances; the trial balance nets to
zero; order and PO headers equal the sum of their lines; each invoiced order has exactly one delivery and one
invoice; document dates are in sequence; no invoice is overpaid; stock is never negative; and the inventory,
AR and AP sub-ledgers each equal their GL control account. Procurement checks: GRNI equals goods received but
not yet invoiced and approved; approved invoice = receipt value + variance; received ≤ ordered; every PO traces
to an approved requisition at the right approval level; on-hold invoices are never posted or paid; and each
product has exactly one preferred supplier.

## Ground truth (not part of the ERP)

`data/ground_truth/` (generated, not committed) holds the hidden drivers of the simulation, as labels for analytics and ML work:
- `customer_behaviour.csv`: volume weight, payment behaviour, default start date, churn date
- `product_demand.csv`: popularity and quantity factor
- `supplier_reliability.csv`: profile, on-time probability, delay range, short-ship, rejection and invoice-error rates

Use them to test credit-risk, churn or demand-forecast models against the true answer.

## Known simplifications

- One delivery and one invoice per order (no partial shipments).
- At most 2 deliveries per PO and one supplier invoice per delivery. Short receipts and rejections close the shortfall (no back-orders to suppliers). Rejected units are not tracked as separate return-to-vendor documents.
- RFQs are for one product at a time; there are no long-term contracts or volume discounts.
- No opening AR/AP, fixed assets or tax withholding.
- No credit-limit enforcement or returns/credit notes.
- All amounts are in THB.

## Layout

```
src/erp_synth/
  config.py      # all tunable knobs (dates, sizes, demand, finance)
  reference.py   # static reference data: provinces, names, catalog, CoA, seasonality, holidays
  master.py      # master-data generation + inventory policies
  simulate.py    # day-by-day simulation engine + GL postings
  schema.sql     # SQLite DDL (source of truth for columns)
  export.py      # SQLite + CSV writers
  validate.py    # integrity checks + summary metrics
src/erp_api/app.py   # read-only FastAPI JSON API (+ serves web/dist when built)
                     # stock dashboard: GET /api/inventory/dashboard, /api/inventory/items (cached per filter)
src/erp_api/auth.py  # Supabase Auth, membership verification and session cookies
supabase/migrations/ # database session and membership policies
web-next/            # Next.js starter
web/                 # React frontend (pages/, components/, lib/)
.claude/skills/ui-ux-pro-max/  # UI/UX design-intelligence skill (MIT, nextlevelbuilder)
tests/               # smoke tests
```

## Credits

- Built with [Claude Code](https://claude.com/claude-code).
- UI guidance: [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (MIT), vendored in `.claude/skills/`.

All company and person names are fictional.
