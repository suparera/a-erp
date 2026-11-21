import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useParams } from "react-router";
import { DataTable, Pagination } from "../components/DataTable";
import { useChartColors, useReducedMotion } from "../components/theme";
import { Badge, Card, CardHeader, cx, DefinitionList, ErrorState, FilterBar, Kpi, PageHeader, PageSkeleton, SearchInput, Select, StatusBadge } from "../components/ui";
import { useApi, useMeta, useUrlState, type Paged } from "../lib/api";
import { baht, bahtCompact, compact, date, money, monthLabel, num, pct } from "../lib/format";

interface CustomerRow {
  customer_id: number; customer_code: string; name: string; segment: string; province: string; region: string;
  credit_limit: number; payment_terms_days: number; sales_rep: string; revenue_ytd: number; last_invoice_date: string | null;
  open_ar: number; overdue_ar: number;
}

export function CustomersPage() {
  const { data: meta } = useMeta();
  const [f, set] = useUrlState({ q: "", segment: "", region: "", sort: "revenue_ytd", dir: "desc", page: "1" });
  const { data, error, isLoading, isFetching } = useApi<Paged<CustomerRow>>("customers", { ...f, page_size: 25 });

  return (
    <>
      <PageHeader title="Customers" description="Retail shops, contractors and wholesalers. Revenue is excl. VAT; receivables incl. VAT." />
      <FilterBar>
        <SearchInput value={f.q} onChange={(q) => set({ q })} placeholder="Name, code or tax ID" />
        <Select label="Segment" value={f.segment} onChange={(e) => set({ segment: e.target.value })}
          options={[{ value: "", label: "All segments" }, ...(meta?.segments ?? []).map((s) => ({ value: s, label: s }))]} />
        <Select label="Region" value={f.region} onChange={(e) => set({ region: e.target.value })}
          options={[{ value: "", label: "All regions" }, ...(meta?.regions ?? []).map((s) => ({ value: s, label: s }))]} />
      </FilterBar>
      {error ? <ErrorState error={error} /> : (
        <Card>
          <DataTable caption="Customers" rows={data?.items} loading={isLoading} fetching={isFetching}
            rowKey={(r) => r.customer_id} rowHref={(r) => `/customers/${r.customer_id}`}
            sort={f.sort} dir={f.dir} onSort={(sort, dir) => set({ sort, dir })}
            columns={[
              { key: "customer_code", header: "Code", sortable: true, render: (r) => <span className="font-mono">{r.customer_code}</span> },
              { key: "name", header: "Name", sortable: true, render: (r) => <div className="min-w-52">{r.name}</div> },
              { key: "segment", header: "Segment", render: (r) => <Badge>{r.segment}</Badge> },
              { key: "province", header: "Province", render: (r) => <span className="whitespace-nowrap">{r.province}</span> },
              { key: "sales_rep", header: "Sales rep", render: (r) => <span className="whitespace-nowrap">{r.sales_rep}</span> },
              { key: "payment_terms_days", header: "Terms", align: "right", render: (r) => (r.payment_terms_days ? `${r.payment_terms_days}d` : "Cash") },
              { key: "credit_limit", header: "Credit limit", align: "right", sortable: true, render: (r) => compact(r.credit_limit) },
              { key: "revenue_ytd", header: "Revenue YTD", align: "right", sortable: true, render: (r) => money(r.revenue_ytd) },
              { key: "open_ar", header: "Open AR", align: "right", sortable: true, render: (r) => money(r.open_ar) },
              { key: "overdue_ar", header: "Overdue", align: "right", sortable: true, render: (r) => <span className={r.overdue_ar > 0 ? "text-destructive" : "text-muted-foreground"}>{money(r.overdue_ar)}</span> },
            ]} />
          {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => set({ page: p })} />}
        </Card>
      )}
    </>
  );
}

interface CustomerDetail extends CustomerRow {
  tax_id: string; phone: string; email: string; created_date: string; warehouse_name: string;
  stats: { revenue_lifetime: number; invoices: number; open_ar: number | null; overdue_ar: number | null; first_invoice_date: string; last_invoice_date: string; avg_days_to_pay: number | null; avg_days_late: number | null };
  monthly: { month: string; revenue: number; invoices: number }[];
  top_products: { product_id: number; sku: string; name: string; quantity: number; revenue: number }[];
  open_invoices: { invoice_id: number; invoice_number: string; sales_order_id: number; invoice_date: string; due_date: string; total_amount: number; paid: number; balance: number; days_overdue: number; bucket: string }[];
  recent_orders: { sales_order_id: number; order_number: string; order_date: string; status: string; total_amount: number }[];
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const { data: c, error, isLoading } = useApi<CustomerDetail>(`customers/${id}`);
  const colors = useChartColors();
  const reduced = useReducedMotion();
  if (error) return <ErrorState error={error} />;
  if (isLoading || !c) return <PageSkeleton />;
  const s = c.stats;
  const util = c.credit_limit ? ((s.open_ar ?? 0) / c.credit_limit) * 100 : 0;

  return (
    <>
      <PageHeader back={{ to: "/customers", label: "Customers" }} title={c.name} badge={<Badge>{c.segment}</Badge>}
        description={<><span className="font-mono">{c.customer_code}</span> · {c.province}, {c.region} · customer since {date(c.created_date)}</>} />

      <div className="mb-8 grid grid-cols-2 gap-6 xl:grid-cols-4">
        <Kpi label="Lifetime revenue" value={bahtCompact(s.revenue_lifetime)} sub={`${num(s.invoices)} invoices since ${date(s.first_invoice_date)}`} />
        <Kpi label="Open receivables" value={baht(s.open_ar ?? 0)}
          sub={s.overdue_ar ? `${baht(s.overdue_ar)} overdue` : "Nothing overdue"} tone={s.overdue_ar ? "danger" : "success"} />
        <Kpi label="Avg. days to pay" value={s.avg_days_to_pay != null ? `${s.avg_days_to_pay} days` : "—"}
          sub={s.avg_days_late != null ? (s.avg_days_late > 0 ? `${s.avg_days_late} days after due on average` : `${Math.abs(s.avg_days_late)} days before due on average`) : undefined}
          tone={s.avg_days_late != null && s.avg_days_late > 15 ? "danger" : s.avg_days_late != null && s.avg_days_late > 0 ? "warning" : "success"} />
        <div className="min-w-0 border-t border-rule pt-2.5 pb-1">
          <span className="label text-muted-foreground">Credit utilisation</span>
          <div className="num mt-1.5 font-serif text-[1.75rem] leading-none font-medium tracking-[-0.02em] sm:text-[2rem]">{pct(util)}</div>
          <div className="mt-2.5 h-1.5 bg-muted" role="meter" aria-valuenow={Math.round(util)} aria-valuemin={0} aria-valuemax={100} aria-label="Credit utilisation">
            <div className={cx("h-1.5", util > 90 ? "bg-destructive" : util > 70 ? "bg-warning" : "bg-foreground")} style={{ width: `${Math.min(100, util)}%` }} />
          </div>
          <div className="num mt-1.5 text-xs text-muted-foreground">of {baht(c.credit_limit)} limit</div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Monthly revenue" description="Invoiced, excl. VAT" />
          <div className="h-64 p-2 pr-4">
            {c.monthly.length < 2 ? <p className="p-4 text-sm text-muted-foreground">Not enough history to chart.</p> : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={c.monthly} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={colors["chart-grid"]} vertical={false} />
                  <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fill: colors["muted-foreground"], fontSize: 11 }} tickLine={false} axisLine={{ stroke: colors.border }} minTickGap={16} />
                  <YAxis tickFormatter={(v) => compact(v)} tick={{ fill: colors["muted-foreground"], fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip contentStyle={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: colors.foreground, fontWeight: 600 }} labelFormatter={(l) => monthLabel(String(l))}
                    formatter={(v) => [baht(Number(v)), "Revenue"]} />
                  <Area dataKey="revenue" stroke={colors["chart-1"]} fill={colors["chart-1"]} fillOpacity={0.15} strokeWidth={2} isAnimationActive={!reduced} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Account" />
          <DefinitionList items={[
            ["Tax ID", <span key="t" className="font-mono">{c.tax_id}</span>],
            ["Phone", c.phone], ["Email", c.email], ["Sales rep", c.sales_rep],
            ["Ships from", c.warehouse_name],
            ["Payment terms", c.payment_terms_days ? `${c.payment_terms_days} days` : "Cash on delivery"],
            ["Last invoice", date(s.last_invoice_date)],
          ]} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Open invoices" description={`${c.open_invoices.length} unpaid`} />
          <DataTable dense caption="Open invoices" rows={c.open_invoices} rowKey={(r) => r.invoice_id} rowHref={(r) => `/sales-orders/${r.sales_order_id}`}
            columns={[
              { key: "invoice_number", header: "Invoice", render: (r) => <span className="font-mono">{r.invoice_number}</span> },
              { key: "due_date", header: "Due", render: (r) => date(r.due_date) },
              { key: "bucket", header: "Ageing", render: (r) => <StatusBadge status={r.bucket} /> },
              { key: "balance", header: "Balance", align: "right", render: (r) => money(r.balance) },
            ]} />
        </Card>
        <Card>
          <CardHeader title="Recent orders" />
          <DataTable dense caption="Recent orders" rows={c.recent_orders} rowKey={(r) => r.sales_order_id} rowHref={(r) => `/sales-orders/${r.sales_order_id}`}
            columns={[
              { key: "order_number", header: "Order #", render: (r) => <span className="font-mono">{r.order_number}</span> },
              { key: "order_date", header: "Date", render: (r) => date(r.order_date) },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
              { key: "total_amount", header: "Total", align: "right", render: (r) => money(r.total_amount) },
            ]} />
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Top products" description="Lifetime, by revenue" />
          <DataTable dense caption="Top products" rows={c.top_products} rowKey={(r) => r.product_id} rowHref={(r) => `/inventory/products/${r.product_id}`}
            columns={[
              { key: "sku", header: "SKU", render: (r) => <span className="font-mono">{r.sku}</span> },
              { key: "name", header: "Product" },
              { key: "quantity", header: "Qty", align: "right", render: (r) => num(r.quantity) },
              { key: "revenue", header: "Revenue", align: "right", render: (r) => money(r.revenue) },
            ]} />
        </Card>
      </div>
    </>
  );
}
