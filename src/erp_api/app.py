"""A-ERP read-only JSON API over the synthetic SQLite database.

"Today" for the app is the dataset's last posting date (AS_OF), so ageing / YTD figures are meaningful.
Run: uv run uvicorn erp_api.app:app --reload --port 8000
"""
import os
import sqlite3
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, Response
from pydantic import BaseModel, model_validator
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import auth
from .auth import require_user

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.environ.get("ERP_DB", ROOT / "data" / "erp.sqlite")).resolve()
WEB_DIST = ROOT / "web" / "dist"

app = FastAPI(title="A-ERP API", version="0.1.0")
# Every data endpoint requires a signed-in user (Supabase Auth and its database session)
api = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


# ---------------------------------------------------------------- db helpers
def get_db():
    if not DB_PATH.exists():
        raise HTTPException(503, f"Database not found at {DB_PATH}. Run: uv run python -m erp_synth generate")
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, check_same_thread=False)
    con.row_factory = sqlite3.Row
    try:
        yield con
    finally:
        con.close()


DB = Depends(get_db)


def rows(con, sql, params=None):
    return [dict(r) for r in con.execute(sql, params or {})]


def one(con, sql, params=None):
    r = con.execute(sql, params or {}).fetchone()
    return dict(r) if r else None


def paginate(con, base_sql, params, sort, direction, allowed, default, page, page_size):
    total = con.execute(f"SELECT COUNT(*) FROM ({base_sql})", params).fetchone()[0]
    col = sort if sort in allowed else default
    d = "ASC" if direction == "asc" else "DESC"
    items = rows(con, f"SELECT * FROM ({base_sql}) ORDER BY {col} {d}, 1 DESC LIMIT :_limit OFFSET :_offset",
                 {**params, "_limit": page_size, "_offset": (page - 1) * page_size})
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@lru_cache(maxsize=1)
def _as_of(db_mtime: float) -> str:
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    try:
        return con.execute("SELECT MAX(entry_date) FROM journal_entries").fetchone()[0]
    finally:
        con.close()


def as_of() -> str:
    return _as_of(DB_PATH.stat().st_mtime)


PageQ = Query(1, ge=1)
SizeQ = Query(25, ge=1, le=200)

# Open-invoice view with paid / balance / days overdue as of :as_of
INVOICES = """
SELECT i.*, c.name AS customer_name, c.segment, c.customer_code,
       COALESCE(p.paid, 0) AS paid, ROUND(i.total_amount - COALESCE(p.paid, 0), 2) AS balance,
       CAST(julianday(:as_of) - julianday(i.due_date) AS INTEGER) AS days_overdue
FROM sales_invoices i
JOIN customers c USING (customer_id)
LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM customer_payments GROUP BY 1) p USING (invoice_id)
"""
BUCKET = """CASE WHEN days_overdue <= 0 THEN 'Current' WHEN days_overdue <= 30 THEN '1-30'
                 WHEN days_overdue <= 60 THEN '31-60' WHEN days_overdue <= 90 THEN '61-90' ELSE '90+' END"""
BUCKETS = ["Current", "1-30", "31-60", "61-90", "90+"]

STOCK = """
SELECT ip.product_id, ip.warehouse_id, ip.reorder_point, ip.reorder_qty,
       COALESCE(s.on_hand, 0) AS on_hand, ROUND(COALESCE(s.value, 0), 2) AS value,
       COALESCE(o.on_order, 0) AS on_order
FROM inventory_policies ip
LEFT JOIN (SELECT product_id, warehouse_id, SUM(quantity) AS on_hand, SUM(total_cost) AS value
           FROM inventory_transactions GROUP BY 1, 2) s USING (product_id, warehouse_id)
LEFT JOIN (SELECT l.product_id, po.warehouse_id, SUM(l.quantity - l.received_quantity) AS on_order
           FROM purchase_order_lines l JOIN purchase_orders po USING (purchase_order_id)
           WHERE po.status IN ('OPEN', 'PARTIALLY_RECEIVED') GROUP BY 1, 2) o USING (product_id, warehouse_id)
"""


def journal_for(con, refs):
    """refs: list of (source_type, source_id). Returns entries with nested lines."""
    refs = [(t, i) for t, i in refs if i is not None]
    if not refs:
        return []
    cond = " OR ".join(f"(source_type = :t{k} AND source_id = :i{k})" for k in range(len(refs)))
    params = {f"t{k}": t for k, (t, _) in enumerate(refs)} | {f"i{k}": i for k, (_, i) in enumerate(refs)}
    entries = rows(con, f"SELECT * FROM journal_entries WHERE {cond} ORDER BY entry_date, journal_entry_id", params)
    for e in entries:
        e["lines"] = rows(con, """SELECT jl.line_no, jl.account_code, a.name AS account_name, jl.debit, jl.credit
                                  FROM journal_lines jl JOIN chart_of_accounts a USING (account_code)
                                  WHERE journal_entry_id = :id ORDER BY line_no""", {"id": e["journal_entry_id"]})
    return entries


# ---------------------------------------------------------------- meta
@api.get("/meta")
def meta(con=DB):
    return {
        "as_of": as_of(),
        "company": one(con, "SELECT * FROM company"),
        "warehouses": rows(con, "SELECT * FROM warehouses ORDER BY warehouse_id"),
        "categories": rows(con, "SELECT * FROM product_categories ORDER BY name"),
        "suppliers": rows(con, "SELECT supplier_id, supplier_code, name FROM suppliers ORDER BY name"),
        "segments": ["Retail", "Contractor", "Wholesale"],
        "regions": [r["region"] for r in rows(con, "SELECT DISTINCT region FROM customers ORDER BY 1")],
    }


# ---------------------------------------------------------------- dashboard
@api.get("/dashboard")
def dashboard(con=DB):
    ao = as_of()
    year = int(ao[:4])
    ytd = {"s": f"{year}-01-01", "e": ao, "ps": f"{year - 1}-01-01", "pe": f"{year - 1}{ao[4:]}", "as_of": ao}

    def revenue(s, e):
        return one(con, """SELECT COALESCE(SUM(subtotal),0) AS revenue, COUNT(*) AS invoices
                           FROM sales_invoices WHERE invoice_date BETWEEN :s AND :e""", {"s": s, "e": e})

    cur, prev = revenue(ytd["s"], ytd["e"]), revenue(ytd["ps"], ytd["pe"])
    cogs = one(con, """SELECT COALESCE(SUM(debit - credit),0) AS v FROM journal_lines JOIN journal_entries USING (journal_entry_id)
                       WHERE account_code IN ('5000','5100') AND entry_date BETWEEN :s AND :e""", ytd)["v"]
    ar = one(con, f"""SELECT ROUND(SUM(balance),2) AS open_ar, ROUND(SUM(CASE WHEN days_overdue > 0 THEN balance END),2) AS overdue_ar,
                             COUNT(*) AS open_invoices
                      FROM ({INVOICES}) WHERE balance > 0.005""", ytd)
    inv = one(con, f"""SELECT ROUND(SUM(value),2) AS value,
                              SUM(CASE WHEN on_hand <= 0 THEN 1 ELSE 0 END) AS out_of_stock,
                              SUM(CASE WHEN on_hand > 0 AND on_hand < reorder_point THEN 1 ELSE 0 END) AS below_rop
                       FROM ({STOCK}) s JOIN products p USING (product_id)
                       WHERE p.is_active = 1 OR s.on_hand > 0""")
    so = one(con, "SELECT COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS value FROM sales_orders WHERE status = 'OPEN'")
    po = one(con, "SELECT COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS value FROM purchase_orders WHERE status IN ('OPEN', 'PARTIALLY_RECEIVED')")
    last90 = one(con, "SELECT SUM(total_amount) AS v FROM sales_invoices WHERE invoice_date > date(:as_of, '-90 day')", ytd)["v"] or 1
    monthly = rows(con, """
        SELECT substr(je.entry_date, 1, 7) AS month,
               ROUND(SUM(CASE WHEN account_code = '4000' THEN credit - debit ELSE 0 END), 2) AS revenue,
               ROUND(SUM(CASE WHEN account_code IN ('5000','5100') THEN debit - credit ELSE 0 END), 2) AS cogs,
               ROUND(SUM(CASE WHEN account_code LIKE '6%' THEN debit - credit ELSE 0 END), 2) AS opex
        FROM journal_lines JOIN journal_entries je USING (journal_entry_id)
        WHERE je.source_type <> 'OPENING' GROUP BY 1 ORDER BY 1""")
    for m in monthly:
        m["gross_profit"] = round(m["revenue"] - m["cogs"], 2)
        m["gross_margin_pct"] = round(m["gross_profit"] / m["revenue"] * 100, 1) if m["revenue"] else None
    by_segment = rows(con, """SELECT c.segment, ROUND(SUM(i.subtotal),2) AS revenue, COUNT(*) AS invoices
                              FROM sales_invoices i JOIN customers c USING (customer_id)
                              WHERE invoice_date BETWEEN :s AND :e GROUP BY 1 ORDER BY 2 DESC""", ytd)
    by_category = rows(con, """SELECT pc.name AS category, ROUND(SUM(l.line_amount),2) AS revenue
                               FROM sales_order_lines l JOIN sales_orders so USING (sales_order_id)
                               JOIN products p USING (product_id) JOIN product_categories pc USING (category_id)
                               WHERE so.status = 'INVOICED' AND so.order_date BETWEEN :s AND :e GROUP BY 1 ORDER BY 2 DESC""", ytd)
    top_customers = rows(con, """SELECT c.customer_id, c.name, c.segment, ROUND(SUM(i.subtotal),2) AS revenue, COUNT(*) AS invoices
                                 FROM sales_invoices i JOIN customers c USING (customer_id)
                                 WHERE invoice_date BETWEEN :s AND :e GROUP BY 1 ORDER BY revenue DESC LIMIT 8""", ytd)
    aging = {r["bucket"]: r for r in rows(con, f"""SELECT {BUCKET} AS bucket, ROUND(SUM(balance),2) AS amount, COUNT(*) AS invoices
                                                    FROM ({INVOICES}) WHERE balance > 0.005 GROUP BY 1""", ytd)}
    return {
        "as_of": ao, "year": year,
        "kpis": {
            "revenue_ytd": cur["revenue"], "revenue_prev_ytd": prev["revenue"],
            "revenue_growth_pct": round((cur["revenue"] / prev["revenue"] - 1) * 100, 1) if prev["revenue"] else None,
            "gross_margin_pct_ytd": round((cur["revenue"] - cogs) / cur["revenue"] * 100, 1) if cur["revenue"] else None,
            "invoices_ytd": cur["invoices"],
            "open_ar": ar["open_ar"] or 0, "overdue_ar": ar["overdue_ar"] or 0, "open_invoices": ar["open_invoices"],
            "dso_days": round((ar["open_ar"] or 0) / last90 * 90, 1),
            "inventory_value": inv["value"], "out_of_stock": inv["out_of_stock"], "below_reorder_point": inv["below_rop"],
            "open_sales_orders": so["n"], "open_sales_orders_value": so["value"],
            "open_purchase_orders": po["n"], "open_purchase_orders_value": po["value"],
        },
        "monthly": monthly,
        "revenue_by_segment": by_segment,
        "revenue_by_category": by_category,
        "top_customers": top_customers,
        "ar_aging": [{"bucket": b, **aging.get(b, {"amount": 0, "invoices": 0})} for b in BUCKETS],
    }


# ---------------------------------------------------------------- sales orders
@api.get("/sales-orders")
def sales_orders(q: str | None = None, status: str | None = None, warehouse_id: int | None = None,
                 customer_id: int | None = None, category: str | None = None, date_from: str | None = None, date_to: str | None = None,
                 sort: str = "order_date", dir: str = "desc", page: int = PageQ, page_size: int = SizeQ, con=DB):
    where, p = ["1=1"], {}
    if q:
        where.append("(so.order_number LIKE :q OR c.name LIKE :q OR c.customer_code LIKE :q)")
        p["q"] = f"%{q}%"
    for col, val in (("so.status", status), ("so.warehouse_id", warehouse_id), ("so.customer_id", customer_id)):
        if val is not None:
            key = col.split(".")[1]
            where.append(f"{col} = :{key}")
            p[key] = val
    if date_from:
        where.append("so.order_date >= :df"); p["df"] = date_from
    if date_to:
        where.append("so.order_date <= :dt"); p["dt"] = date_to
    if category:
        where.append("EXISTS (SELECT 1 FROM sales_order_lines fl JOIN products fp USING (product_id) JOIN product_categories fc USING (category_id) WHERE fl.sales_order_id = so.sales_order_id AND fc.name = :category)")
        p["category"] = category
    base = f"""SELECT so.sales_order_id, so.order_number, so.order_date, so.requested_date, so.status, so.cancel_reason,
                      so.customer_id, c.name AS customer_name, c.segment, w.code AS warehouse,
                      so.subtotal, so.total_amount, d.ship_date,
                      (SELECT COUNT(*) FROM sales_order_lines l WHERE l.sales_order_id = so.sales_order_id) AS line_count
               FROM sales_orders so JOIN customers c USING (customer_id) JOIN warehouses w ON w.warehouse_id = so.warehouse_id
               LEFT JOIN deliveries d USING (sales_order_id)
               WHERE {' AND '.join(where)}"""
    return paginate(con, base, p, sort, dir, {"order_date", "order_number", "customer_name", "total_amount", "status", "ship_date"},
                    "order_date", page, page_size)


@api.get("/sales-orders/{sales_order_id}")
def sales_order(sales_order_id: int, con=DB):
    so = one(con, """SELECT so.*, c.name AS customer_name, c.customer_code, c.segment, c.payment_terms_days,
                            e.first_name || ' ' || e.last_name AS sales_rep, w.name AS warehouse_name, w.code AS warehouse
                     FROM sales_orders so JOIN customers c USING (customer_id)
                     JOIN employees e ON e.employee_id = so.sales_rep_id JOIN warehouses w ON w.warehouse_id = so.warehouse_id
                     WHERE sales_order_id = :id""", {"id": sales_order_id})
    if not so:
        raise HTTPException(404, "Sales order not found")
    so["lines"] = rows(con, """SELECT l.*, p.sku, p.name AS product_name, p.uom FROM sales_order_lines l
                               JOIN products p USING (product_id) WHERE sales_order_id = :id ORDER BY line_no""", {"id": sales_order_id})
    so["delivery"] = one(con, "SELECT * FROM deliveries WHERE sales_order_id = :id", {"id": sales_order_id})
    so["invoice"] = one(con, f"SELECT * FROM ({INVOICES}) WHERE sales_order_id = :id", {"id": sales_order_id, "as_of": as_of()})
    so["payments"] = rows(con, "SELECT * FROM customer_payments WHERE invoice_id = :id ORDER BY payment_date",
                          {"id": so["invoice"]["invoice_id"]}) if so["invoice"] else []
    refs = [("DELIVERY", so["delivery"] and so["delivery"]["delivery_id"]),
            ("SALES_INVOICE", so["invoice"] and so["invoice"]["invoice_id"])]
    refs += [("CUSTOMER_PAYMENT", pmt["payment_id"]) for pmt in so["payments"]]
    so["journal_entries"] = journal_for(con, refs)
    return so


# ---------------------------------------------------------------- customers
@api.get("/customers")
def customers(q: str | None = None, segment: str | None = None, region: str | None = None,
              sort: str = "revenue_ytd", dir: str = "desc", page: int = PageQ, page_size: int = SizeQ, con=DB):
    ao = as_of()
    where, p = ["1=1"], {"as_of": ao, "ys": f"{ao[:4]}-01-01"}
    if q:
        where.append("(c.name LIKE :q OR c.customer_code LIKE :q OR c.tax_id LIKE :q)"); p["q"] = f"%{q}%"
    if segment:
        where.append("c.segment = :segment"); p["segment"] = segment
    if region:
        where.append("c.region = :region"); p["region"] = region
    base = f"""SELECT c.customer_id, c.customer_code, c.name, c.segment, c.province, c.region, c.credit_limit,
                      c.payment_terms_days, e.first_name || ' ' || e.last_name AS sales_rep,
                      COALESCE(r.revenue_ytd, 0) AS revenue_ytd, r.last_invoice_date,
                      COALESCE(a.open_ar, 0) AS open_ar, COALESCE(a.overdue_ar, 0) AS overdue_ar
               FROM customers c JOIN employees e ON e.employee_id = c.sales_rep_id
               LEFT JOIN (SELECT customer_id, ROUND(SUM(CASE WHEN invoice_date >= :ys THEN subtotal END),2) AS revenue_ytd,
                                 MAX(invoice_date) AS last_invoice_date FROM sales_invoices GROUP BY 1) r USING (customer_id)
               LEFT JOIN (SELECT customer_id, ROUND(SUM(balance),2) AS open_ar,
                                 ROUND(SUM(CASE WHEN days_overdue > 0 THEN balance END),2) AS overdue_ar
                          FROM ({INVOICES}) WHERE balance > 0.005 GROUP BY 1) a USING (customer_id)
               WHERE {' AND '.join(where)}"""
    return paginate(con, base, p, sort, dir, {"revenue_ytd", "name", "customer_code", "open_ar", "overdue_ar", "last_invoice_date", "credit_limit"},
                    "revenue_ytd", page, page_size)


@api.get("/customers/{customer_id}")
def customer(customer_id: int, con=DB):
    ao = as_of()
    c = one(con, """SELECT c.*, e.first_name || ' ' || e.last_name AS sales_rep, w.name AS warehouse_name
                    FROM customers c JOIN employees e ON e.employee_id = c.sales_rep_id
                    JOIN warehouses w ON w.warehouse_id = c.default_warehouse_id WHERE customer_id = :id""", {"id": customer_id})
    if not c:
        raise HTTPException(404, "Customer not found")
    p = {"id": customer_id, "as_of": ao}
    c["stats"] = one(con, f"""SELECT ROUND(SUM(subtotal),2) AS revenue_lifetime, COUNT(*) AS invoices,
                                     ROUND(SUM(CASE WHEN balance > 0.005 THEN balance END),2) AS open_ar,
                                     ROUND(SUM(CASE WHEN balance > 0.005 AND days_overdue > 0 THEN balance END),2) AS overdue_ar,
                                     MIN(invoice_date) AS first_invoice_date, MAX(invoice_date) AS last_invoice_date
                              FROM ({INVOICES}) WHERE customer_id = :id""", p)
    c["stats"]["avg_days_to_pay"] = one(con, """
        SELECT ROUND(AVG(julianday(last_pay) - julianday(invoice_date)), 1) AS v FROM (
            SELECT i.invoice_date, MAX(cp.payment_date) AS last_pay FROM sales_invoices i
            JOIN customer_payments cp USING (invoice_id) WHERE i.customer_id = :id GROUP BY i.invoice_id)""", p)["v"]
    c["stats"]["avg_days_late"] = one(con, """
        SELECT ROUND(AVG(julianday(last_pay) - julianday(due_date)), 1) AS v FROM (
            SELECT i.due_date, MAX(cp.payment_date) AS last_pay FROM sales_invoices i
            JOIN customer_payments cp USING (invoice_id) WHERE i.customer_id = :id GROUP BY i.invoice_id)""", p)["v"]
    c["monthly"] = rows(con, """SELECT substr(invoice_date,1,7) AS month, ROUND(SUM(subtotal),2) AS revenue, COUNT(*) AS invoices
                                FROM sales_invoices WHERE customer_id = :id GROUP BY 1 ORDER BY 1""", p)
    c["top_products"] = rows(con, """SELECT p.product_id, p.sku, p.name, SUM(l.quantity) AS quantity, ROUND(SUM(l.line_amount),2) AS revenue
                                     FROM sales_order_lines l JOIN sales_orders so USING (sales_order_id) JOIN products p USING (product_id)
                                     WHERE so.customer_id = :id AND so.status = 'INVOICED' GROUP BY 1 ORDER BY revenue DESC LIMIT 8""", p)
    c["open_invoices"] = rows(con, f"""SELECT invoice_id, invoice_number, sales_order_id, invoice_date, due_date, total_amount, paid, balance,
                                              days_overdue, {BUCKET} AS bucket
                                       FROM ({INVOICES}) WHERE customer_id = :id AND balance > 0.005 ORDER BY due_date""", p)
    c["recent_orders"] = rows(con, """SELECT sales_order_id, order_number, order_date, status, total_amount FROM sales_orders
                                      WHERE customer_id = :id ORDER BY order_date DESC, sales_order_id DESC LIMIT 15""", p)
    return c


# ---------------------------------------------------------------- inventory
@api.get("/inventory")
def inventory(q: str | None = None, warehouse_id: int | None = None, category_id: int | None = None,
              stock_status: str | None = Query(None, pattern="^(out|low|ok)$"), include_inactive: bool = False,
              sort: str = "value", dir: str = "desc", page: int = PageQ, page_size: int = SizeQ, con=DB):
    where, p = ["1=1"], {}
    if not include_inactive:
        where.append("p.is_active = 1")
    if q:
        where.append("(p.sku LIKE :q OR p.name LIKE :q OR p.brand LIKE :q)"); p["q"] = f"%{q}%"
    if warehouse_id:
        where.append("s.warehouse_id = :wid"); p["wid"] = warehouse_id
    if category_id:
        where.append("p.category_id = :cid"); p["cid"] = category_id
    status_expr = "CASE WHEN s.on_hand <= 0 THEN 'out' WHEN s.on_hand < s.reorder_point THEN 'low' ELSE 'ok' END"
    if stock_status:
        where.append(f"{status_expr} = :st"); p["st"] = stock_status
    base = f"""SELECT p.product_id || '-' || s.warehouse_id AS id, p.product_id, p.sku, p.name, p.brand, p.uom,
                      pc.name AS category, w.code AS warehouse, s.warehouse_id, s.on_hand, s.on_order, s.reorder_point, s.reorder_qty,
                      s.value, CASE WHEN s.on_hand > 0 THEN ROUND(s.value / s.on_hand, 2) END AS avg_cost,
                      p.list_price, p.is_active, {status_expr} AS stock_status
               FROM ({STOCK}) s JOIN products p USING (product_id) JOIN product_categories pc USING (category_id)
               JOIN warehouses w ON w.warehouse_id = s.warehouse_id
               WHERE {' AND '.join(where)}"""
    result = paginate(con, base, p, sort, dir, {"value", "sku", "name", "on_hand", "on_order", "reorder_point", "category", "warehouse"},
                      "value", page, page_size)
    result["summary"] = one(con, f"""SELECT COUNT(*) AS item_locations, ROUND(SUM(value),2) AS value,
                                            SUM(stock_status = 'out') AS out_of_stock, SUM(stock_status = 'low') AS low
                                     FROM ({base})""", p)
    return result


# ---------------------------------------------------------------- stock dashboard
# Definitions (shown in the UI):
#   days of cover   = on hand ÷ average daily units shipped over the last 90 days
#   turns / year    = cost of goods shipped in the last 12 months ÷ current stock value
#   ABC class       = products ranked by 12-month cost of goods shipped: A = first 80%, B = next 15%, C = rest
#   fill rate       = sales-order lines shipped from stock within 2 days of the order (orders of the last 90 days)
#   status          = out | at_risk (cover < supplier lead time) | low (below reorder point) | dead (no sale in 90 days)
#                     | excess (cover > 120 days) | ok
COVER_LOW, COVER_HIGH, EXCESS_DAYS = 14, 60, 120


def _health_params(warehouse_id, category_id, abc):
    ao = as_of()
    p = {"as_of": ao, "d90": _shift(ao, -90), "d365": _shift(ao, -365)}
    where = ["1=1"]
    if warehouse_id:
        where.append("i.warehouse_id = :wid"); p["wid"] = warehouse_id
    if category_id:
        where.append("i.category_id = :cid"); p["cid"] = category_id
    if abc:
        where.append("i.abc = :abc"); p["abc"] = abc
    return p, " AND ".join(where)


def _shift(iso_date: str, days: int) -> str:
    from datetime import date, timedelta
    return (date.fromisoformat(iso_date) + timedelta(days=days)).isoformat()


ITEMS = f"""
WITH agg AS (SELECT product_id, warehouse_id, SUM(quantity) AS on_hand, SUM(total_cost) AS value,
                    -SUM(CASE WHEN txn_type = 'SHIPMENT' AND txn_date > :d90 THEN quantity ELSE 0 END) AS units90,
                    -SUM(CASE WHEN txn_type = 'SHIPMENT' AND txn_date > :d365 THEN total_cost ELSE 0 END) AS cogs365,
                    MAX(CASE WHEN txn_type = 'SHIPMENT' THEN txn_date END) AS last_sale
             FROM inventory_transactions GROUP BY 1, 2),
cogs12 AS (SELECT product_id, SUM(cogs365) AS v FROM agg GROUP BY 1),
ranked AS (SELECT p.product_id, COALESCE(c.v, 0) AS v,
                  SUM(COALESCE(c.v, 0)) OVER (ORDER BY COALESCE(c.v, 0) DESC, p.product_id ROWS UNBOUNDED PRECEDING) AS cum,
                  SUM(COALESCE(c.v, 0)) OVER () AS tot
           FROM products p LEFT JOIN cogs12 c USING (product_id)),
abc AS (SELECT product_id, CASE WHEN v = 0 THEN 'C' WHEN cum - v < 0.80 * tot THEN 'A'
                                WHEN cum - v < 0.95 * tot THEN 'B' ELSE 'C' END AS cls FROM ranked),
incoming AS (SELECT l.product_id, po.warehouse_id, SUM(l.quantity - l.received_quantity) AS qty, MIN(po.expected_date) AS next_date
             FROM purchase_order_lines l JOIN purchase_orders po USING (purchase_order_id)
             WHERE po.status IN ('OPEN', 'PARTIALLY_RECEIVED') GROUP BY 1, 2),
pending AS (SELECT rl.product_id, r.warehouse_id, SUM(rl.quantity) AS qty FROM purchase_requisition_lines rl
            JOIN purchase_requisitions r USING (requisition_id) WHERE r.status = 'PENDING_APPROVAL' GROUP BY 1, 2),
ontime AS (SELECT po.supplier_id, AVG(g.receipt_date <= po.expected_date) AS rate FROM goods_receipts g
           JOIN purchase_orders po USING (purchase_order_id) WHERE g.delivery_no = 1 GROUP BY 1),
base AS (
  SELECT ip.product_id, ip.warehouse_id, p.sku, p.name, p.uom, p.category_id, pc.name AS category, w.code AS warehouse,
         a.cls AS abc, p.is_active, COALESCE(s.on_hand, 0) AS on_hand, ROUND(COALESCE(s.value, 0), 2) AS value,
         ip.reorder_point, ROUND(COALESCE(s.units90, 0) / 90.0, 2) AS per_day,
         CASE WHEN COALESCE(s.units90, 0) > 0 THEN ROUND(COALESCE(s.on_hand, 0) / (s.units90 / 90.0), 1) END AS cover_days,
         sp.lead_time_days AS lead_time, sup.name AS supplier, ROUND(ot.rate * 100, 1) AS supplier_on_time,
         COALESCE(inc.qty, 0) AS incoming, inc.next_date AS next_expected, COALESCE(pd.qty, 0) AS pending_req, s.last_sale,
         ROUND(COALESCE(s.cogs365, 0), 2) AS cogs365
  FROM inventory_policies ip
  JOIN products p USING (product_id) JOIN product_categories pc USING (category_id)
  JOIN warehouses w ON w.warehouse_id = ip.warehouse_id
  JOIN abc a ON a.product_id = ip.product_id
  JOIN supplier_products sp ON sp.product_id = ip.product_id AND sp.is_preferred = 1
  JOIN suppliers sup ON sup.supplier_id = sp.supplier_id
  LEFT JOIN agg s ON s.product_id = ip.product_id AND s.warehouse_id = ip.warehouse_id
  LEFT JOIN incoming inc ON inc.product_id = ip.product_id AND inc.warehouse_id = ip.warehouse_id
  LEFT JOIN pending pd ON pd.product_id = ip.product_id AND pd.warehouse_id = ip.warehouse_id
  LEFT JOIN ontime ot ON ot.supplier_id = sp.supplier_id
  WHERE p.is_active = 1 OR COALESCE(s.on_hand, 0) > 0          -- discontinued items still holding stock count as dead stock
),
items AS (
  SELECT *,
    CASE WHEN on_hand <= 0 THEN 'out'
         WHEN is_active = 0 THEN 'dead'
         WHEN cover_days IS NOT NULL AND cover_days < lead_time THEN 'at_risk'
         WHEN on_hand < reorder_point THEN 'low'
         WHEN last_sale IS NULL OR last_sale <= :d90 THEN 'dead'
         WHEN cover_days > {EXCESS_DAYS} THEN 'excess'
         ELSE 'ok' END AS status,
    CASE WHEN on_hand <= 0 OR (cover_days IS NOT NULL AND cover_days < {COVER_LOW}) THEN 'low'
         WHEN cover_days IS NULL OR cover_days > {COVER_HIGH} THEN 'high' ELSE 'ok' END AS cover_band,
    CASE WHEN cover_days IS NOT NULL THEN ROUND(cover_days - lead_time, 1) END AS cover_gap
  FROM base
)
"""


def _db_version() -> float:
    return DB_PATH.stat().st_mtime


@lru_cache(maxsize=64)
def _health_items(version: float, warehouse_id, category_id, abc) -> tuple:
    """Item-location health rows for a filter combination; cached until the database file changes."""
    p, where = _health_params(warehouse_id, category_id, abc)
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        return tuple(dict(r) for r in con.execute(f"{ITEMS} SELECT * FROM items i WHERE {where}", p))
    finally:
        con.close()


@lru_cache(maxsize=64)
def _stock_dashboard(version: float, warehouse_id, category_id, abc) -> dict:
    p, _ = _health_params(warehouse_id, category_id, abc)
    ao = p["as_of"]
    items = _health_items(version, warehouse_id, category_id, abc)
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        filtered = warehouse_id or category_id or abc
        if filtered:  # restrict transaction queries to the selected item-locations
            con.execute("CREATE TEMP TABLE sel_keys (product_id INT, warehouse_id INT, PRIMARY KEY (product_id, warehouse_id)) WITHOUT ROWID")
            con.executemany("INSERT INTO sel_keys VALUES (?, ?)", sorted({(r["product_id"], r["warehouse_id"]) for r in items}))
            tx = "inventory_transactions t JOIN sel_keys k ON k.product_id = t.product_id AND k.warehouse_id = t.warehouse_id"
            sol = "JOIN sel_keys k ON k.product_id = l.product_id AND k.warehouse_id = so.warehouse_id"
        else:
            tx, sol = "inventory_transactions t", ""
        prev_month_end = _shift(ao[:8] + "01", -1)
        sc = one(con, f"""SELECT COALESCE(SUM(CASE WHEN t.txn_date <= :pme THEN t.total_cost END), 0) AS prev_value,
                                 COALESCE(-SUM(CASE WHEN t.txn_type = 'SHIPMENT' AND t.txn_date > :d90 THEN t.total_cost END), 0) AS cogs90,
                                 COALESCE(-SUM(CASE WHEN t.txn_type = 'ADJUSTMENT' AND t.txn_date > :d365 THEN t.total_cost END), 0) AS shrink365
                          FROM {tx}""", {**p, "pme": prev_month_end})
        # Monthly net movement per warehouse → cumulative month-end value; plus receipts / shipments / adjustments
        net = rows(con, f"""SELECT substr(t.txn_date, 1, 7) AS month, w.code, ROUND(SUM(t.total_cost), 2) AS net,
                                   SUM(CASE WHEN t.txn_type = 'RECEIPT' THEN t.total_cost ELSE 0 END) AS receipts,
                                   -SUM(CASE WHEN t.txn_type = 'SHIPMENT' THEN t.total_cost ELSE 0 END) AS shipments,
                                   SUM(CASE WHEN t.txn_type = 'ADJUSTMENT' THEN t.total_cost ELSE 0 END) AS adjustments
                            FROM {tx} JOIN warehouses w ON w.warehouse_id = t.warehouse_id GROUP BY 1, 2 ORDER BY 1""")
        fill = rows(con, f"""SELECT so.warehouse_id, COUNT(*) AS lines,
                                    SUM(d.ship_date IS NOT NULL AND julianday(d.ship_date) - julianday(so.order_date) <= 2) AS ok
                             FROM sales_order_lines l JOIN sales_orders so USING (sales_order_id) {sol}
                             LEFT JOIN deliveries d USING (sales_order_id)
                             WHERE so.order_date > :d90 AND so.order_date <= :cut AND COALESCE(so.cancel_reason, '') <> 'Customer request'
                             GROUP BY 1""", {"d90": p["d90"], "cut": _shift(ao, -2)})
        shrinkage_top = rows(con, f"""SELECT p.product_id, p.sku, p.name, w.code AS warehouse, -SUM(t.quantity) AS units, ROUND(-SUM(t.total_cost), 2) AS value
                                      FROM {tx} JOIN products p ON p.product_id = t.product_id JOIN warehouses w ON w.warehouse_id = t.warehouse_id
                                      WHERE t.txn_type = 'ADJUSTMENT' AND t.txn_date > :d GROUP BY 1, 4 HAVING value > 0
                                      ORDER BY value DESC LIMIT 6""", {"d": p["d365"]})
        codes = {w["warehouse_id"]: w["code"] for w in rows(con, "SELECT warehouse_id, code FROM warehouses")}
    finally:
        con.close()

    value = round(sum(r["value"] for r in items), 2)
    trend, movements, running = [], [], {}
    months = sorted({r["month"] for r in net})
    for i, month in enumerate(months):
        mrows = [r for r in net if r["month"] == month]
        for r in mrows:
            running[r["code"]] = round(running.get(r["code"], 0) + r["net"], 2)
        if i == 0 and len(months) > 1 and not any(r["shipments"] or r["receipts"] for r in mrows):
            continue  # opening-balance month (only OPENING rows): carried into the first trading month
        trend.append({"month": month, **running, "total": round(sum(running.values()), 2),
                      "cogs": round(sum(r["shipments"] for r in mrows), 2)})
        movements.append({"month": month, "receipts": round(sum(r["receipts"] for r in mrows), 2),
                          "shipments": round(sum(r["shipments"] for r in mrows), 2),
                          "adjustments": round(sum(r["adjustments"] for r in mrows), 2)})
    fill_ok, fill_lines = sum(f["ok"] or 0 for f in fill), sum(f["lines"] for f in fill)

    by_status: dict = {}
    for r in items:
        b = by_status.setdefault(r["status"], {"items": 0, "value": 0.0})
        b["items"] += 1
        b["value"] += r["value"]
    st = lambda k, f="items": round(by_status.get(k, {}).get(f, 0), 2)

    warehouses = []
    for wid, code in sorted(codes.items()):
        wi = [r for r in items if r["warehouse_id"] == wid]
        if not wi:
            continue
        wv = sum(r["value"] for r in wi)
        wf = next((f for f in fill if f["warehouse_id"] == wid), None)
        warehouses.append({"warehouse_id": wid, "code": code, "items": len(wi), "value": round(wv, 2),
                           "turns": round(sum(r["cogs365"] for r in wi) / wv, 1) if wv else None,
                           "fill_rate": round((wf["ok"] or 0) / wf["lines"] * 100, 1) if wf and wf["lines"] else None,
                           "out": sum(r["status"] == "out" for r in wi), "at_risk": sum(r["status"] == "at_risk" for r in wi),
                           "low": sum(r["status"] == "low" for r in wi),
                           "dead_value": round(sum(r["value"] for r in wi if r["status"] == "dead"), 2)})
    grid = [{"abc": a, "cover": band, "items": len(cell), "value": round(sum(r["value"] for r in cell), 2)}
            for a in "ABC" for band in ("low", "ok", "high")
            for cell in [[r for r in items if r["abc"] == a and r["cover_band"] == band]]]
    return {
        "as_of": ao,
        "definitions": {"cover_low": COVER_LOW, "cover_high": COVER_HIGH, "excess_days": EXCESS_DAYS},
        "kpis": {
            "stock_value": value, "prev_month_value": round(sc["prev_value"], 2), "prev_month_end": prev_month_end,
            "days_of_cover": round(value / (sc["cogs90"] / 90), 1) if sc["cogs90"] else None,
            "turns": round(sum(r["cogs365"] for r in items) / value, 1) if value else None,
            "fill_rate": round(fill_ok / fill_lines * 100, 1) if fill_lines else None,
            "items": len(items), "out": st("out"), "at_risk": st("at_risk"), "low": st("low"),
            "dead_items": st("dead"), "dead_value": st("dead", "value"),
            "excess_items": st("excess"), "excess_value": st("excess", "value"),
            "shrinkage_12m": round(sc["shrink365"], 2),
        },
        "status_counts": {k: {"items": v["items"], "value": round(v["value"], 2)} for k, v in by_status.items()},
        "trend": trend, "movements": movements, "warehouses": warehouses, "abc_grid": grid, "shrinkage_top": shrinkage_top,
    }


@api.get("/inventory/dashboard")
def stock_dashboard(warehouse_id: int | None = None, category_id: int | None = None,
                    abc: str | None = Query(None, pattern="^[ABC]$")):
    return _stock_dashboard(_db_version(), warehouse_id, category_id, abc)


ITEM_SORTS = {"urgency", "value", "cover_days", "on_hand", "sku", "last_sale", "cover_gap", "abc", "warehouse"}


@api.get("/inventory/items")
def stock_items(view: str = Query("risk", pattern="^(risk|excess|all)$"), warehouse_id: int | None = None,
                category_id: int | None = None, abc: str | None = Query(None, pattern="^[ABC]$"),
                cover: str | None = Query(None, pattern="^(low|ok|high)$"), q: str | None = None,
                sort: str | None = None, dir: str | None = None, page: int = PageQ, page_size: int = SizeQ):
    items = _health_items(_db_version(), warehouse_id, category_id, abc)
    keep = {"risk": {"out", "at_risk", "low"}, "excess": {"dead", "excess"}, "all": None}[view]
    ql = q.lower() if q else None
    sel = [dict(r, id=f"{r['product_id']}-{r['warehouse_id']}",
                urgency=-1000 if r["status"] == "out" else (r["cover_gap"] if r["cover_gap"] is not None else 999))
           for r in items
           if (keep is None or r["status"] in keep) and (not cover or r["cover_band"] == cover)
           and (not ql or ql in r["sku"].lower() or ql in r["name"].lower())]
    # default ordering: most urgent first for risk, most money tied up first for the others
    sort = sort if sort in ITEM_SORTS else ("urgency" if view == "risk" else "value")
    dir = dir or ("asc" if sort == "urgency" else "desc")
    sel.sort(key=lambda r: (r[sort] is None, r[sort] if r[sort] is not None else 0), reverse=(dir == "desc"))
    if dir == "desc":  # keep NULLs last when descending too
        sel = [r for r in sel if r[sort] is not None] + [r for r in sel if r[sort] is None]
    start = (page - 1) * page_size
    return {"items": sel[start:start + page_size], "total": len(sel), "page": page, "page_size": page_size}


@api.get("/products/{product_id}")
def product(product_id: int, con=DB):
    pr = one(con, """SELECT p.*, pc.name AS category, s.name AS supplier_name, s.lead_time_days
                     FROM products p JOIN product_categories pc USING (category_id)
                     JOIN suppliers s ON s.supplier_id = p.primary_supplier_id WHERE product_id = :id""", {"id": product_id})
    if not pr:
        raise HTTPException(404, "Product not found")
    pr["prices"] = rows(con, "SELECT * FROM product_prices WHERE product_id = :id ORDER BY valid_from", {"id": product_id})
    pr["stock"] = rows(con, f"""SELECT s.*, w.code AS warehouse FROM ({STOCK}) s JOIN warehouses w USING (warehouse_id)
                                WHERE product_id = :id ORDER BY warehouse_id""", {"id": product_id})
    pr["monthly_sales"] = rows(con, """SELECT substr(so.order_date,1,7) AS month, SUM(l.quantity) AS quantity, ROUND(SUM(l.line_amount),2) AS revenue
                                       FROM sales_order_lines l JOIN sales_orders so USING (sales_order_id)
                                       WHERE l.product_id = :id AND so.status = 'INVOICED' GROUP BY 1 ORDER BY 1""", {"id": product_id})
    pr["recent_movements"] = rows(con, """SELECT t.*, w.code AS warehouse FROM inventory_transactions t JOIN warehouses w USING (warehouse_id)
                                          WHERE product_id = :id ORDER BY txn_date DESC, inventory_txn_id DESC LIMIT 25""", {"id": product_id})
    return pr


# ---------------------------------------------------------------- purchasing
@api.get("/purchase-orders")
def purchase_orders(q: str | None = None, status: str | None = None, supplier_id: int | None = None,
                    warehouse_id: int | None = None, sort: str = "order_date", dir: str = "desc",
                    page: int = PageQ, page_size: int = SizeQ, con=DB):
    where, p = ["1=1"], {}
    if q:
        where.append("(po.po_number LIKE :q OR s.name LIKE :q)"); p["q"] = f"%{q}%"
    if status == "OPEN":
        where.append("po.status IN ('OPEN', 'PARTIALLY_RECEIVED')")
    elif status:
        where.append("po.status = :status"); p["status"] = status
    if supplier_id:
        where.append("po.supplier_id = :sid"); p["sid"] = supplier_id
    if warehouse_id:
        where.append("po.warehouse_id = :wid"); p["wid"] = warehouse_id
    base = f"""SELECT po.purchase_order_id, po.po_number, po.order_date, po.expected_date, po.status, s.name AS supplier_name,
                      w.code AS warehouse, po.total_amount, g.receipt_date, g.deliveries,
                      (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.purchase_order_id = po.purchase_order_id) AS line_count,
                      CASE WHEN g.receipt_date IS NOT NULL THEN CAST(julianday(g.receipt_date) - julianday(po.expected_date) AS INTEGER) END AS days_late,
                      (SELECT COUNT(*) FROM supplier_invoices si WHERE si.purchase_order_id = po.purchase_order_id AND si.status = 'ON_HOLD') AS invoices_on_hold
               FROM purchase_orders po JOIN suppliers s USING (supplier_id) JOIN warehouses w ON w.warehouse_id = po.warehouse_id
               LEFT JOIN (SELECT purchase_order_id, MIN(receipt_date) AS receipt_date, COUNT(*) AS deliveries
                          FROM goods_receipts GROUP BY 1) g USING (purchase_order_id)
               WHERE {' AND '.join(where)}"""
    return paginate(con, base, p, sort, dir, {"order_date", "po_number", "supplier_name", "total_amount", "expected_date", "status"},
                    "order_date", page, page_size)


@api.get("/purchase-orders/{purchase_order_id}")
def purchase_order(purchase_order_id: int, con=DB):
    po = one(con, """SELECT po.*, s.name AS supplier_name, s.supplier_code, s.payment_terms_days, s.lead_time_days,
                            e.first_name || ' ' || e.last_name AS buyer, w.name AS warehouse_name, w.code AS warehouse
                     FROM purchase_orders po JOIN suppliers s USING (supplier_id)
                     JOIN employees e ON e.employee_id = po.buyer_id JOIN warehouses w ON w.warehouse_id = po.warehouse_id
                     WHERE purchase_order_id = :id""", {"id": purchase_order_id})
    if not po:
        raise HTTPException(404, "Purchase order not found")
    p = {"id": purchase_order_id}
    po["lines"] = rows(con, """SELECT l.*, pr.sku, pr.name AS product_name, pr.uom FROM purchase_order_lines l
                               JOIN products pr USING (product_id) WHERE purchase_order_id = :id ORDER BY line_no""", p)
    po["requisition"] = one(con, """SELECT r.*, rq.first_name || ' ' || rq.last_name AS requested_by_name,
                                          ap.first_name || ' ' || ap.last_name AS approver_name, ap.job_title AS approver_title
                                   FROM purchase_requisitions r JOIN employees rq ON rq.employee_id = r.requested_by
                                   LEFT JOIN employees ap ON ap.employee_id = r.approver_id
                                   WHERE r.requisition_id = :rid""", {"rid": po["requisition_id"]})
    po["goods_receipts"] = rows(con, """SELECT g.*, e.first_name || ' ' || e.last_name AS received_by_name FROM goods_receipts g
                                        JOIN employees e ON e.employee_id = g.received_by WHERE purchase_order_id = :id ORDER BY delivery_no""", p)
    for g in po["goods_receipts"]:
        g["lines"] = rows(con, """SELECT gl.*, pr.sku, pr.name AS product_name FROM goods_receipt_lines gl JOIN products pr USING (product_id)
                                  WHERE goods_receipt_id = :g ORDER BY gr_line_id""", {"g": g["goods_receipt_id"]})
    po["supplier_invoices"] = rows(con, """SELECT si.*, e.first_name || ' ' || e.last_name AS approved_by_name FROM supplier_invoices si
                                           LEFT JOIN employees e ON e.employee_id = si.approved_by
                                           WHERE purchase_order_id = :id ORDER BY invoice_date, supplier_invoice_id""", p)
    for si in po["supplier_invoices"]:
        si["lines"] = rows(con, """SELECT sl.*, pr.sku, pr.name AS product_name FROM supplier_invoice_lines sl JOIN products pr USING (product_id)
                                   WHERE supplier_invoice_id = :s ORDER BY line_no""", {"s": si["supplier_invoice_id"]})
        si["payments"] = rows(con, "SELECT * FROM supplier_payments WHERE supplier_invoice_id = :s ORDER BY payment_date",
                              {"s": si["supplier_invoice_id"]})
    po["payments"] = [x for si in po["supplier_invoices"] for x in si["payments"]]
    refs = [("GOODS_RECEIPT", g["goods_receipt_id"]) for g in po["goods_receipts"]]
    refs += [("SUPPLIER_INVOICE", si["supplier_invoice_id"]) for si in po["supplier_invoices"]]
    refs += [("SUPPLIER_PAYMENT", x["supplier_payment_id"]) for x in po["payments"]]
    po["journal_entries"] = journal_for(con, refs)
    return po


# ---------------------------------------------------------------- receivables
@api.get("/receivables")
def receivables(q: str | None = None, bucket: str | None = None, segment: str | None = None,
                sort: str = "days_overdue", dir: str = "desc", page: int = PageQ, page_size: int = SizeQ, con=DB):
    p = {"as_of": as_of()}
    where = ["balance > 0.005"]
    if q:
        where.append("(invoice_number LIKE :q OR customer_name LIKE :q OR customer_code LIKE :q)"); p["q"] = f"%{q}%"
    if bucket:
        where.append(f"{BUCKET} = :bucket"); p["bucket"] = bucket
    if segment:
        where.append("segment = :segment"); p["segment"] = segment
    base = f"""SELECT invoice_id, invoice_number, sales_order_id, customer_id, customer_name, customer_code, segment,
                      invoice_date, due_date, total_amount, paid, balance, days_overdue, {BUCKET} AS bucket
               FROM ({INVOICES}) WHERE {' AND '.join(where)}"""
    result = paginate(con, base, p, sort, dir, {"days_overdue", "balance", "invoice_date", "due_date", "customer_name", "invoice_number"},
                      "days_overdue", page, page_size)
    aging = {r["bucket"]: r for r in rows(con, f"""SELECT {BUCKET} AS bucket, ROUND(SUM(balance),2) AS amount, COUNT(*) AS invoices
                                                    FROM ({INVOICES}) WHERE balance > 0.005 GROUP BY 1""", p)}
    result["aging"] = [{"bucket": b, **aging.get(b, {"amount": 0, "invoices": 0})} for b in BUCKETS]
    result["as_of"] = p["as_of"]
    return result


# ---------------------------------------------------------------- general ledger
@api.get("/gl/trial-balance")
def trial_balance(as_of_date: str | None = None, con=DB):
    d = as_of_date or as_of()
    accts = rows(con, """SELECT a.account_code, a.name, a.account_type, a.normal_balance,
                                ROUND(COALESCE(SUM(jl.debit),0),2) AS debit, ROUND(COALESCE(SUM(jl.credit),0),2) AS credit
                         FROM chart_of_accounts a
                         LEFT JOIN journal_lines jl USING (account_code)
                         LEFT JOIN journal_entries je ON je.journal_entry_id = jl.journal_entry_id
                         WHERE je.entry_date IS NULL OR je.entry_date <= :d
                         GROUP BY 1 ORDER BY 1""", {"d": d})
    for a in accts:
        net = a["debit"] - a["credit"]
        a["balance"] = round(net if a["normal_balance"] == "DEBIT" else -net, 2)
    return {"as_of": d, "accounts": accts,
            "total_debit": round(sum(a["debit"] for a in accts), 2), "total_credit": round(sum(a["credit"] for a in accts), 2)}


@api.get("/gl/income-statement")
def income_statement(year: int | None = None, con=DB):
    y = year or int(as_of()[:4])
    data = rows(con, """SELECT a.account_code, a.name, a.account_type, substr(je.entry_date,6,2) AS month,
                               ROUND(SUM(CASE WHEN a.account_type = 'REVENUE' THEN jl.credit - jl.debit ELSE jl.debit - jl.credit END), 2) AS amount
                        FROM journal_lines jl JOIN journal_entries je USING (journal_entry_id) JOIN chart_of_accounts a USING (account_code)
                        WHERE a.account_type IN ('REVENUE','EXPENSE') AND substr(je.entry_date,1,4) = :y AND je.source_type <> 'OPENING'
                        GROUP BY 1, 4 ORDER BY 1, 4""", {"y": str(y)})
    months = sorted({r["month"] for r in data})
    accounts = {}
    for r in data:
        a = accounts.setdefault(r["account_code"], {"account_code": r["account_code"], "name": r["name"],
                                                    "account_type": r["account_type"], "months": {}, "total": 0.0})
        a["months"][r["month"]] = r["amount"]
        a["total"] = round(a["total"] + r["amount"], 2)
    years = [int(r["y"]) for r in rows(con, "SELECT DISTINCT substr(entry_date,1,4) AS y FROM journal_entries WHERE source_type <> 'OPENING' ORDER BY 1")]
    return {"year": y, "years": years, "months": months, "accounts": list(accounts.values())}


@api.get("/gl/accounts/{account_code}/lines")
def account_lines(account_code: str, date_from: str | None = None, date_to: str | None = None,
                  source_type: str | None = None, page: int = PageQ, page_size: int = Query(50, ge=1, le=200),
                  dir: str = "desc", con=DB):
    acct = one(con, "SELECT * FROM chart_of_accounts WHERE account_code = :a", {"a": account_code})
    if not acct:
        raise HTTPException(404, "Account not found")
    where, p = ["jl.account_code = :a"], {"a": account_code}
    if date_from:
        where.append("je.entry_date >= :df"); p["df"] = date_from
    if date_to:
        where.append("je.entry_date <= :dt"); p["dt"] = date_to
    if source_type:
        where.append("je.source_type = :st"); p["st"] = source_type
    sign = "1" if acct["normal_balance"] == "DEBIT" else "-1"
    base = f"""SELECT jl.journal_line_id, je.journal_entry_id, je.entry_number, je.entry_date, je.source_type, je.source_id,
                      je.description, jl.debit, jl.credit,
                      ROUND(SUM({sign} * (jl.debit - jl.credit)) OVER (ORDER BY je.entry_date, jl.journal_line_id), 2) AS running_balance
               FROM journal_lines jl JOIN journal_entries je USING (journal_entry_id) WHERE {' AND '.join(where)}"""
    result = paginate(con, base, p, "entry_date", dir, {"entry_date"}, "entry_date", page, page_size)
    result["account"] = acct
    result["source_types"] = [r["source_type"] for r in rows(con, """SELECT DISTINCT je.source_type FROM journal_lines jl
                                                                     JOIN journal_entries je USING (journal_entry_id) WHERE account_code = :a ORDER BY 1""", p)]
    return result


# ---------------------------------------------------------------- auth (public endpoints)
class Credentials(BaseModel):
    email: str | None = None
    username: str | None = None
    password: str

    @model_validator(mode="after")
    def validate_identifier(self):
        if (self.email is None) == (self.username is None):
            raise ValueError("Provide exactly one of username or email")
        return self


@app.post("/api/auth/login")
def login(body: Credentials, response: Response):
    identifier = (body.username or body.email or "").strip()
    session = auth.exchange("password", {"email": auth.login_email(identifier), "password": body.password})
    user = auth.verify_user(session["access_token"])
    auth.set_session(response, session)
    response.headers["Cache-Control"] = "private, no-store"
    return {"user": user}


@app.post("/api/auth/refresh", status_code=204)
def refresh(request: Request, response: Response):
    token = request.cookies.get(auth.REFRESH_COOKIE)
    if not token:
        raise HTTPException(401, "Sign in required.")
    session = auth.exchange("refresh_token", {"refresh_token": token})
    auth.verify_user(session["access_token"])
    auth.set_session(response, session)
    response.headers["Cache-Control"] = "private, no-store"


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request, response: Response):
    token = request.cookies.get(auth.ACCESS_COOKIE)
    refresh_token = request.cookies.get(auth.REFRESH_COOKIE)
    revoked = bool(token and auth.revoke_session(token))
    if not revoked and refresh_token:
        try:
            refreshed = auth.exchange("refresh_token", {"refresh_token": refresh_token})
        except HTTPException as exc:
            if exc.status_code != 401:
                raise
        else:
            auth.revoke_session(refreshed["access_token"])
    auth.clear_session(response)
    response.headers["Cache-Control"] = "private, no-store"


@api.get("/auth/me")
def me(user: dict = Depends(require_user)):
    return user


@app.get("/api/health")
def health():
    configured = bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_PUBLISHABLE_KEY"))
    return {"ok": DB_PATH.exists(), "auth": "supabase" if configured else "unconfigured"}


app.include_router(api)


# ---------------------------------------------------------------- built frontend (production)
if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = WEB_DIST / path
        if path and f.is_file() and WEB_DIST in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(WEB_DIST / "index.html")
