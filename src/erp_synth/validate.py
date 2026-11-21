"""Integrity checks + headline metrics over the generated SQLite database."""
import sqlite3

from . import reference as ref

CHECKS = [
    ("Foreign keys valid",
     "SELECT COUNT(*) FROM pragma_foreign_key_check"),
    ("Every journal entry balances",
     "SELECT COUNT(*) FROM (SELECT journal_entry_id FROM journal_lines GROUP BY 1 HAVING ABS(SUM(debit)-SUM(credit)) > 0.005)"),
    ("Trial balance nets to zero",
     "SELECT CASE WHEN ABS(SUM(debit)-SUM(credit)) > 0.01 THEN 1 ELSE 0 END FROM journal_lines"),
    ("Sales order totals = sum of lines",
     """SELECT COUNT(*) FROM sales_orders so JOIN (SELECT sales_order_id, SUM(line_amount) s FROM sales_order_lines GROUP BY 1) l
        USING (sales_order_id) WHERE ABS(so.subtotal - l.s) > 0.01 OR ABS(so.total_amount - so.subtotal - so.vat_amount) > 0.01"""),
    ("PO totals = sum of lines",
     """SELECT COUNT(*) FROM purchase_orders po JOIN (SELECT purchase_order_id, SUM(line_amount) s FROM purchase_order_lines GROUP BY 1) l
        USING (purchase_order_id) WHERE ABS(po.subtotal - l.s) > 0.01"""),
    ("Invoiced orders have exactly one delivery & invoice",
     """SELECT COUNT(*) FROM sales_orders so LEFT JOIN deliveries d USING (sales_order_id) LEFT JOIN sales_invoices i USING (sales_order_id)
        WHERE (so.status = 'INVOICED') <> (d.delivery_id IS NOT NULL AND i.invoice_id IS NOT NULL)"""),
    ("Document dates are in sequence",
     """SELECT (SELECT COUNT(*) FROM deliveries d JOIN sales_orders so USING (sales_order_id) WHERE d.ship_date < so.order_date)
             + (SELECT COUNT(*) FROM customer_payments p JOIN sales_invoices i USING (invoice_id) WHERE p.payment_date < i.invoice_date)
             + (SELECT COUNT(*) FROM goods_receipts g JOIN purchase_orders po USING (purchase_order_id) WHERE g.receipt_date < po.order_date)
             + (SELECT COUNT(*) FROM supplier_invoices s JOIN goods_receipts g USING (goods_receipt_id) WHERE s.invoice_date < g.receipt_date)
             + (SELECT COUNT(*) FROM supplier_payments p JOIN supplier_invoices s USING (supplier_invoice_id) WHERE p.payment_date < s.invoice_date)"""),
    ("Customers not overpaid",
     """SELECT COUNT(*) FROM sales_invoices i JOIN (SELECT invoice_id, SUM(amount) s FROM customer_payments GROUP BY 1) p
        USING (invoice_id) WHERE p.s > i.total_amount + 0.01"""),
    ("Stock never negative",
     """SELECT COUNT(*) FROM (SELECT SUM(quantity) OVER (PARTITION BY product_id, warehouse_id
                                ORDER BY txn_date, inventory_txn_id) bal FROM inventory_transactions) WHERE bal < 0"""),
    ("Inventory sub-ledger = GL 1200",
     """SELECT CASE WHEN ABS((SELECT SUM(total_cost) FROM inventory_transactions)
              - (SELECT SUM(debit-credit) FROM journal_lines WHERE account_code='1200')) > 0.05 THEN 1 ELSE 0 END"""),
    ("AR sub-ledger = GL 1100",
     """SELECT CASE WHEN ABS((SELECT SUM(total_amount) FROM sales_invoices) - (SELECT SUM(amount) FROM customer_payments)
              - (SELECT SUM(debit-credit) FROM journal_lines WHERE account_code='1100')) > 0.05 THEN 1 ELSE 0 END"""),
    ("AP sub-ledger = GL 2000 (approved invoices − payments)",
     """SELECT CASE WHEN ABS((SELECT COALESCE(SUM(total_amount),0) FROM supplier_invoices WHERE approved_date IS NOT NULL)
              - (SELECT COALESCE(SUM(amount),0) FROM supplier_payments)
              - (SELECT SUM(credit-debit) FROM journal_lines WHERE account_code='2000')) > 0.05 THEN 1 ELSE 0 END"""),
    ("GRNI (GL 2150) = goods received not yet invoiced & approved",
     """SELECT CASE WHEN ABS((SELECT COALESCE(SUM(t.total_cost),0) FROM inventory_transactions t WHERE t.txn_type='RECEIPT')
              - (SELECT COALESCE(SUM(receipt_value),0) FROM supplier_invoices WHERE approved_date IS NOT NULL)
              - (SELECT SUM(credit-debit) FROM journal_lines WHERE account_code='2150')) > 0.05 THEN 1 ELSE 0 END"""),
    ("Approved invoice = receipt value + price variance",
     """SELECT COUNT(*) FROM supplier_invoices WHERE approved_date IS NOT NULL
        AND (ABS(subtotal - receipt_value - price_variance) > 0.01 OR ABS(total_amount - subtotal - vat_amount) > 0.01)"""),
    ("Received ≤ ordered and delivered = accepted + rejected",
     """SELECT (SELECT COUNT(*) FROM purchase_order_lines WHERE received_quantity > quantity)
             + (SELECT COUNT(*) FROM goods_receipt_lines WHERE quantity_received <> quantity_accepted + quantity_rejected)
             + (SELECT COUNT(*) FROM purchase_order_lines l JOIN (SELECT po_line_id, SUM(quantity_accepted) a FROM goods_receipt_lines GROUP BY 1) g
                USING (po_line_id) WHERE g.a <> l.received_quantity)"""),
    ("Every PO comes from an approved requisition; approvals follow the matrix",
     """SELECT (SELECT COUNT(*) FROM purchase_orders po JOIN purchase_requisitions r USING (requisition_id) WHERE r.status <> 'CONVERTED')
             + (SELECT COUNT(*) FROM purchase_requisitions r LEFT JOIN purchase_orders po USING (requisition_id)
                WHERE (r.status = 'CONVERTED') <> (po.purchase_order_id IS NOT NULL))
             + (SELECT COUNT(*) FROM purchase_requisitions WHERE
                (approval_level = 'AUTO' AND estimated_amount >= """ + str(int(ref.APPROVAL_MATRIX[0][0])) + """) OR
                (approval_level = 'PURCHASING_MANAGER' AND (estimated_amount < """ + str(int(ref.APPROVAL_MATRIX[0][0])) + """ OR estimated_amount >= """ + str(int(ref.APPROVAL_MATRIX[1][0])) + """)) OR
                (approval_level = 'MANAGING_DIRECTOR' AND estimated_amount < """ + str(int(ref.APPROVAL_MATRIX[1][0])) + """))"""),
    ("Invoices on hold are not posted or paid",
     """SELECT (SELECT COUNT(*) FROM supplier_invoices WHERE status = 'ON_HOLD' AND (approved_date IS NOT NULL OR total_amount IS NOT NULL))
             + (SELECT COUNT(*) FROM supplier_payments p JOIN supplier_invoices s USING (supplier_invoice_id)
                WHERE s.approved_date IS NULL OR p.payment_date < s.approved_date)"""),
    ("One preferred supplier per product, matching products.primary_supplier_id",
     """SELECT (SELECT COUNT(*) FROM (SELECT product_id FROM supplier_products GROUP BY 1 HAVING SUM(is_preferred) <> 1))
             + (SELECT COUNT(*) FROM products p JOIN supplier_products sp ON sp.product_id = p.product_id AND sp.is_preferred = 1
                WHERE sp.supplier_id <> p.primary_supplier_id)"""),
]

METRICS = """
SELECT substr(je.entry_date,1,4) AS year,
       ROUND(SUM(CASE WHEN account_code='4000' THEN credit-debit END)/1e6, 2) AS revenue_m,
       ROUND(SUM(CASE WHEN account_code IN ('5000','5100') THEN debit-credit END)/1e6, 2) AS cogs_m,
       ROUND(SUM(CASE WHEN account_code LIKE '6%' THEN debit-credit END)/1e6, 2) AS opex_m
FROM journal_lines jl JOIN journal_entries je USING (journal_entry_id)
WHERE je.source_type <> 'OPENING' GROUP BY 1 ORDER BY 1
"""


def run_checks(con: sqlite3.Connection) -> bool:
    ok = True
    print("\nIntegrity checks")
    for name, sql in CHECKS:
        bad = con.execute(sql).fetchone()[0] or 0
        ok &= bad == 0
        print(f"  {'PASS' if bad == 0 else 'FAIL'}  {name}" + (f"  ({bad} violations)" if bad else ""))
    return ok


def print_summary(con: sqlite3.Connection):
    from .export import TABLE_ORDER
    print("\nRow counts")
    for t in TABLE_ORDER:
        print(f"  {t:<24}{con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]:>9,}")
    print("\nP&L (THB millions)")
    print(f"  {'year':<6}{'revenue':>10}{'cogs':>10}{'GM%':>7}{'opex':>9}{'EBIT':>9}")
    for y, rev, cogs, opex in con.execute(METRICS):
        print(f"  {y:<6}{rev:>10.2f}{cogs:>10.2f}{(rev - cogs) / rev * 100:>6.1f}%{opex:>9.2f}{rev - cogs - opex:>9.2f}")
    q = lambda sql: con.execute(sql).fetchone()[0]
    print("\nOperations")
    print(f"  Order status mix      : {dict(con.execute('SELECT status, COUNT(*) FROM sales_orders GROUP BY 1').fetchall())}")
    print(f"  Fill (ship) lead days : {q('SELECT ROUND(AVG(julianday(ship_date)-julianday(order_date)),2) FROM deliveries JOIN sales_orders USING (sales_order_id)')}")
    print(f"  Invoice status mix    : {dict(con.execute('SELECT status, COUNT(*) FROM sales_invoices GROUP BY 1').fetchall())}")
    print("\nProcurement")
    for label, sql in [
        ("Requisitions by status ", "SELECT status, COUNT(*) FROM purchase_requisitions GROUP BY 1"),
        ("Approval levels        ", "SELECT approval_level, COUNT(*) FROM purchase_requisitions GROUP BY 1"),
        ("PO status mix          ", "SELECT status, COUNT(*) FROM purchase_orders GROUP BY 1"),
        ("Invoice match results  ", "SELECT match_status, COUNT(*) FROM supplier_invoices GROUP BY 1"),
        ("Exception resolutions  ", "SELECT COALESCE(resolution,'(on hold)'), COUNT(*) FROM supplier_invoices WHERE match_status='EXCEPTION' GROUP BY 1"),
        ("RFQs by status         ", "SELECT status, COUNT(*) FROM rfqs GROUP BY 1"),
    ]:
        print(f"  {label}: {dict(con.execute(sql).fetchall())}")
    on_time_delivery = q(
        "SELECT ROUND(100.0*SUM(g.receipt_date<=po.expected_date)/COUNT(*),1) "
        "FROM goods_receipts g JOIN purchase_orders po USING(purchase_order_id) WHERE g.delivery_no=1"
    )
    print(f"  On-time first delivery : {on_time_delivery}%")
    print(f"  Avg PO lines           : {q('SELECT ROUND(AVG(n),2) FROM (SELECT COUNT(*) n FROM purchase_order_lines GROUP BY purchase_order_id)')}")
    price_variance = q("SELECT ROUND(SUM(debit-credit),2) FROM journal_lines WHERE account_code='5200'")
    print(f"  Purchase price variance: {price_variance:,.2f} THB")
    print(f"  Closing cash (THB)    : {q(chr(10).join(['SELECT ROUND(SUM(debit-credit),2) FROM journal_lines WHERE account_code=' + repr('1000')])):,.2f}")
    print(f"  Closing AR (THB)      : {q('SELECT ROUND(SUM(debit-credit),2) FROM journal_lines WHERE account_code=' + repr('1100')):,.2f}")
    print(f"  Closing inventory     : {q('SELECT ROUND(SUM(debit-credit),2) FROM journal_lines WHERE account_code=' + repr('1200')):,.2f}")
