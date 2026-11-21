import { Link } from "react-router";
import { DataTable, Pagination } from "../components/DataTable";
import { Badge, Card, cx, ErrorState, FilterBar, PageHeader, SearchInput, Select, StatusBadge } from "../components/ui";
import { useApi, useMeta, useUrlState, type Paged } from "../lib/api";
import { bahtCompact, date, money, num } from "../lib/format";

interface ArRow {
  invoice_id: number; invoice_number: string; sales_order_id: number; customer_id: number; customer_name: string; customer_code: string;
  segment: string; invoice_date: string; due_date: string; total_amount: number; paid: number; balance: number; days_overdue: number; bucket: string;
}
type Aging = { bucket: string; amount: number; invoices: number }[];

const BUCKET = "group border-t-2 pt-2.5 pb-1 text-left transition-colors duration-150 hover:border-accent aria-pressed:[&_.label]:text-accent";
const BUCKET_VAL = "num mt-1.5 mb-1 font-serif text-2xl leading-none font-medium tracking-[-0.02em]";

export function ReceivablesPage() {
  const { data: meta } = useMeta();
  const [f, set] = useUrlState({ q: "", bucket: "", segment: "", sort: "days_overdue", dir: "desc", page: "1" });
  const { data, error, isLoading, isFetching } = useApi<Paged<ArRow> & { aging: Aging; as_of: string }>("receivables", { ...f, page_size: 25 });
  const totalAr = data?.aging.reduce((a, b) => a + b.amount, 0) ?? 0;

  return (
    <>
      <PageHeader title="Receivables" description={`Open customer invoices aged by days past due${data ? `, as of ${date(data.as_of)}` : ""}. Select a bucket to filter.`} />
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-6">
        <button type="button" onClick={() => set({ bucket: "" })} aria-pressed={!f.bucket}
          className={cx(BUCKET, !f.bucket ? "border-accent" : "border-rule")}>
          <div className="label text-muted-foreground">All open</div>
          <div className={BUCKET_VAL}>{bahtCompact(totalAr)}</div>
          <div className="num text-xs text-muted-foreground">{num(data?.aging.reduce((a, b) => a + b.invoices, 0))} invoices</div>
        </button>
        {data?.aging.map((a) => (
          <button key={a.bucket} type="button" onClick={() => set({ bucket: a.bucket })} aria-pressed={f.bucket === a.bucket}
            className={cx(BUCKET, f.bucket === a.bucket ? "border-accent" : "border-rule")}>
            <div className="label flex items-center justify-between gap-1 text-muted-foreground">
              {a.bucket === "Current" ? "Not yet due" : `${a.bucket} days`}
              <span className="num">{totalAr ? Math.round((a.amount / totalAr) * 100) : 0}%</span>
            </div>
            <div className={cx(BUCKET_VAL, a.bucket === "90+" && "text-destructive")}>{bahtCompact(a.amount)}</div>
            <div className="num text-xs text-muted-foreground">{num(a.invoices)} invoices</div>
          </button>
        ))}
      </div>
      <FilterBar>
        <SearchInput value={f.q} onChange={(q) => set({ q })} placeholder="Invoice #, customer name or code" />
        <Select label="Segment" value={f.segment} onChange={(e) => set({ segment: e.target.value })}
          options={[{ value: "", label: "All segments" }, ...(meta?.segments ?? []).map((s) => ({ value: s, label: s }))]} />
      </FilterBar>
      {error ? <ErrorState error={error} /> : (
        <Card>
          <DataTable caption="Open invoices" rows={data?.items} loading={isLoading} fetching={isFetching}
            rowKey={(r) => r.invoice_id} rowHref={(r) => `/sales-orders/${r.sales_order_id}`}
            sort={f.sort} dir={f.dir} onSort={(sort, dir) => set({ sort, dir })}
            columns={[
              { key: "invoice_number", header: "Invoice", sortable: true, render: (r) => <span className="font-mono">{r.invoice_number}</span> },
              { key: "customer_name", header: "Customer", sortable: true, render: (r) => (
                <div className="min-w-52">
                  <Link to={`/customers/${r.customer_id}`} className="hover:text-accent hover:underline">{r.customer_name}</Link>
                  <div className="text-xs text-muted-foreground"><span className="font-mono">{r.customer_code}</span> · {r.segment}</div>
                </div>
              ) },
              { key: "invoice_date", header: "Invoiced", sortable: true, render: (r) => date(r.invoice_date) },
              { key: "due_date", header: "Due", sortable: true, render: (r) => date(r.due_date) },
              { key: "days_overdue", header: "Days overdue", align: "right", sortable: true, render: (r) => (
                r.days_overdue > 0 ? <span className={cx(r.days_overdue > 90 ? "font-medium text-destructive" : r.days_overdue > 30 ? "text-warning" : "")}>{num(r.days_overdue)}</span>
                  : <span className="text-muted-foreground">Due in {num(-r.days_overdue)}</span>
              ) },
              { key: "total_amount", header: "Invoice total", align: "right", render: (r) => money(r.total_amount) },
              { key: "paid", header: "Paid", align: "right", render: (r) => (r.paid ? money(r.paid) : "—") },
              { key: "balance", header: "Balance (THB)", align: "right", sortable: true, render: (r) => <span className="font-medium">{money(r.balance)}</span> },
              { key: "bucket", header: "Ageing", render: (r) => <StatusBadge status={r.bucket} /> },
              { key: "partial", header: "", render: (r) => (r.paid ? <Badge tone="warning">Partial</Badge> : null) },
            ]} />
          {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => set({ page: p })} />}
        </Card>
      )}
    </>
  );
}
