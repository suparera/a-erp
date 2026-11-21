import { Link, useParams } from "react-router";
import { DataTable, Pagination } from "../components/DataTable";
import { DocumentFlow, JournalEntries } from "../components/Documents";
import { Badge, Card, CardHeader, DateInput, DefinitionList, ErrorState, FilterBar, PageHeader, PageSkeleton, SearchInput, Select, StatusBadge } from "../components/ui";
import { useApi, useMeta, useUrlState, type JournalEntry, type Paged } from "../lib/api";
import { baht, date, money, num } from "../lib/format";

interface SalesOrderRow {
  sales_order_id: number; order_number: string; order_date: string; requested_date: string; status: string;
  cancel_reason: string | null; customer_id: number; customer_name: string; segment: string; warehouse: string;
  subtotal: number; total_amount: number; ship_date: string | null; line_count: number;
}

export function SalesOrdersPage() {
  const { data: meta } = useMeta();
  const [f, set] = useUrlState({ q: "", status: "", warehouse_id: "", category: "", date_from: "", date_to: "", sort: "order_date", dir: "desc", page: "1" });
  const { data, error, isLoading, isFetching } = useApi<Paged<SalesOrderRow>>("sales-orders", { ...f, page_size: 25 });

  return (
    <>
      <PageHeader title="Sales Orders" description="Order-to-cash: orders ship when stock is available at the customer's warehouse, then invoice automatically." />
      <FilterBar>
        <SearchInput value={f.q} onChange={(q) => set({ q })} placeholder="Order #, customer name or code" />
        <Select label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })}
          options={[{ value: "", label: "All statuses" }, { value: "OPEN", label: "Open" }, { value: "INVOICED", label: "Invoiced" }, { value: "CANCELLED", label: "Cancelled" }]} />
        <Select label="Warehouse" value={f.warehouse_id} onChange={(e) => set({ warehouse_id: e.target.value })}
          options={[{ value: "", label: "All warehouses" }, ...(meta?.warehouses ?? []).map((w) => ({ value: w.warehouse_id, label: w.code }))]} />
        <Select label="Category" value={f.category} onChange={(e) => set({ category: e.target.value })}
          options={[{ value: "", label: "All categories" }, ...(meta?.categories ?? []).map((c) => ({ value: c.name, label: c.name }))]} />
        <DateInput label="From" value={f.date_from} onChange={(date_from) => set({ date_from })} />
        <DateInput label="To" value={f.date_to} onChange={(date_to) => set({ date_to })} />
      </FilterBar>
      {error ? <ErrorState error={error} /> : (
        <Card>
          <DataTable caption="Sales orders" rows={data?.items} loading={isLoading} fetching={isFetching}
            rowKey={(r) => r.sales_order_id} rowHref={(r) => `/sales-orders/${r.sales_order_id}`}
            sort={f.sort} dir={f.dir} onSort={(sort, dir) => set({ sort, dir })}
            columns={[
              { key: "order_number", header: "Order #", sortable: true, render: (r) => <span className="font-mono">{r.order_number}</span> },
              { key: "order_date", header: "Order date", sortable: true, render: (r) => date(r.order_date) },
              { key: "customer_name", header: "Customer", sortable: true, render: (r) => (
                <div className="min-w-48"><div className="truncate">{r.customer_name}</div><div className="text-xs text-muted-foreground">{r.segment}</div></div>
              ) },
              { key: "warehouse", header: "Warehouse", render: (r) => <span className="font-mono text-xs">{r.warehouse}</span> },
              { key: "line_count", header: "Lines", align: "right", render: (r) => num(r.line_count) },
              { key: "total_amount", header: "Total (THB)", align: "right", sortable: true, render: (r) => money(r.total_amount) },
              { key: "status", header: "Status", sortable: true, render: (r) => <StatusBadge status={r.status} /> },
              { key: "ship_date", header: "Shipped", sortable: true, render: (r) => r.ship_date ? date(r.ship_date) : <span className="text-muted-foreground">{r.cancel_reason ?? "—"}</span> },
            ]} />
          {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => set({ page: p })} />}
        </Card>
      )}
    </>
  );
}

interface SalesOrderDetail extends SalesOrderRow {
  customer_code: string; payment_terms_days: number; sales_rep: string; warehouse_name: string; vat_amount: number; cancelled_date: string | null;
  lines: { sales_order_line_id: number; line_no: number; sku: string; product_id: number; product_name: string; uom: string; quantity: number; unit_price: number; discount_pct: number; line_amount: number }[];
  delivery: { delivery_number: string; ship_date: string } | null;
  invoice: { invoice_number: string; invoice_date: string; due_date: string; status: string; paid: number; balance: number; days_overdue: number } | null;
  payments: { payment_id: number; payment_number: string; payment_date: string; amount: number; method: string }[];
  journal_entries: JournalEntry[];
}

export function SalesOrderDetailPage() {
  const { id } = useParams();
  const { data: so, error, isLoading } = useApi<SalesOrderDetail>(`sales-orders/${id}`);
  if (error) return <ErrorState error={error} />;
  if (isLoading || !so) return <PageSkeleton />;
  const inv = so.invoice;
  const lastPay = so.payments.at(-1);

  return (
    <>
      <PageHeader back={{ to: "/sales-orders", label: "Sales orders" }} title={<span className="font-mono">{so.order_number}</span>}
        badge={<StatusBadge status={so.status} />}
        description={<>Ordered {date(so.order_date)} by <Link to={`/customers/${so.customer_id}`} className="font-medium text-accent hover:underline">{so.customer_name}</Link></>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {so.status !== "CANCELLED" ? (
            <DocumentFlow steps={[
              { label: "Sales order", number: so.order_number, date: so.order_date, done: true },
              { label: "Delivery", number: so.delivery?.delivery_number, date: so.delivery?.ship_date, done: !!so.delivery },
              { label: "Invoice", number: inv?.invoice_number, date: inv?.invoice_date, detail: inv ? `Due ${date(inv.due_date)}` : undefined, done: !!inv },
              { label: "Payment", number: lastPay?.payment_number, date: lastPay?.payment_date,
                detail: inv ? (inv.status === "PAID" ? `${so.payments.length} receipt(s)` : `${baht(inv.balance)} outstanding`) : undefined, done: inv?.status === "PAID" },
            ]} />
          ) : (
            <Card><p className="p-4 text-sm"><span className="font-medium">Cancelled {date(so.cancelled_date)}:</span> {so.cancel_reason}</p></Card>
          )}

          <Card>
            <CardHeader title="Order lines" description={`${so.lines.length} lines`} />
            <DataTable caption="Order lines" rows={so.lines} rowKey={(l) => l.sales_order_line_id} rowHref={(l) => `/inventory/products/${l.product_id}`}
              columns={[
                { key: "sku", header: "SKU", render: (l) => <span className="font-mono text-xs">{l.sku}</span> },
                { key: "product_name", header: "Product", className: "min-w-56" },
                { key: "quantity", header: "Qty", align: "right", render: (l) => `${num(l.quantity)} ${l.uom}` },
                { key: "unit_price", header: "Unit price", align: "right", render: (l) => money(l.unit_price) },
                { key: "discount_pct", header: "Disc.", align: "right", render: (l) => (l.discount_pct ? `${l.discount_pct}%` : "—") },
                { key: "line_amount", header: "Amount", align: "right", render: (l) => money(l.line_amount) },
              ]}
              footer={
                <>
                  <tr><td colSpan={5} className="px-3 py-1.5 text-right text-sm font-normal text-muted-foreground">Subtotal</td><td className="num px-3 py-1.5 text-right">{money(so.subtotal)}</td></tr>
                  <tr><td colSpan={5} className="px-3 py-1.5 text-right text-sm font-normal text-muted-foreground">VAT 7%</td><td className="num px-3 py-1.5 text-right">{money(so.vat_amount)}</td></tr>
                  <tr><td colSpan={5} className="px-3 py-1.5 text-right text-sm">Total (THB)</td><td className="num px-3 py-1.5 text-right">{money(so.total_amount)}</td></tr>
                </>
              } />
          </Card>
          <JournalEntries entries={so.journal_entries} />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Order details" />
            <DefinitionList items={[
              ["Customer", <Link key="c" to={`/customers/${so.customer_id}`} className="text-accent hover:underline">{so.customer_code}</Link>],
              ["Segment", <Badge key="s">{so.segment}</Badge>],
              ["Sales rep", so.sales_rep],
              ["Warehouse", so.warehouse_name],
              ["Requested", date(so.requested_date)],
              ["Payment terms", so.payment_terms_days ? `${so.payment_terms_days} days` : "Cash"],
            ]} />
          </Card>
          {inv && (
            <Card>
              <CardHeader title="Invoice & payments" />
              <DefinitionList items={[
                ["Invoice", <span key="i" className="font-mono">{inv.invoice_number}</span>],
                ["Status", <StatusBadge key="s" status={inv.status} />],
                ["Due date", date(inv.due_date)],
                ["Paid", baht(inv.paid)],
                ["Balance", <span key="b" className={inv.balance > 0 && inv.days_overdue > 0 ? "text-destructive" : ""}>{baht(inv.balance)}</span>],
                ...(inv.balance > 0.005 && inv.days_overdue > 0 ? [["Overdue", `${inv.days_overdue} days`] as [string, string]] : []),
              ]} />
              {so.payments.length > 0 && (
                <ul className="divide-y border-t text-sm">
                  {so.payments.map((p) => (
                    <li key={p.payment_id} className="flex justify-between gap-2 px-4 py-2">
                      <span><span className="font-mono text-xs">{p.payment_number}</span> · {date(p.payment_date)} · {p.method.toLowerCase()}</span>
                      <span className="num font-medium">{money(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
