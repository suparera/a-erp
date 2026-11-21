import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link, useNavigate } from "react-router";
import { DataTable } from "../components/DataTable";
import { useChartColors, useReducedMotion } from "../components/theme";
import { Card, CardHeader, ErrorState, Kpi, PageHeader, PageSkeleton } from "../components/ui";
import { useApi } from "../lib/api";
import { baht, bahtCompact, compact, date, money, monthLabel, num, pct } from "../lib/format";

interface Dashboard {
  as_of: string;
  year: number;
  kpis: Record<string, number>;
  monthly: { month: string; revenue: number; cogs: number; opex: number; gross_profit: number; gross_margin_pct: number }[];
  revenue_by_segment: { segment: string; revenue: number; invoices: number }[];
  revenue_by_category: { category: string; revenue: number }[];
  top_customers: { customer_id: number; name: string; segment: string; revenue: number; invoices: number }[];
  ar_aging: { bucket: string; amount: number; invoices: number }[];
}

export function DashboardPage() {
  const { data, error, isLoading } = useApi<Dashboard>("dashboard");
  const navigate = useNavigate();
  const c = useChartColors();
  const reduced = useReducedMotion();
  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <PageSkeleton />;
  const k = data.kpis;
  const growth = k.revenue_growth_pct;
  const headline = growth == null ? `Revenue ${bahtCompact(k.revenue_ytd)} year to date`
    : `Revenue ${growth >= 0 ? "up" : "down"} ${pct(Math.abs(growth))} on ${data.year - 1}`;
  const watch = [
    k.overdue_ar > 0 && `${bahtCompact(k.overdue_ar)} of receivables is overdue`,
    k.out_of_stock > 0 && `${num(k.out_of_stock)} SKU-locations are out of stock`,
    k.below_reorder_point > 0 && `${num(k.below_reorder_point)} sit below reorder point`,
  ].filter(Boolean) as string[];

  return (
    <>
      <PageHeader eyebrow={`Morning brief · YTD ${data.year} · 1 Jan – ${date(data.as_of)}`} title={headline}
        description={watch.length ? <>Watch today: {watch.join("; ")}.</> : "Nothing needs attention today."} />

      <div className="grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Revenue YTD (excl. VAT)" value={bahtCompact(k.revenue_ytd)} to={`/accounting?tab=is&year=${data.year}`}
          sub={growth != null ? `${growth >= 0 ? "▲" : "▼"} ${pct(Math.abs(growth))} vs same period ${data.year - 1}` : undefined}
          tone={growth != null && growth >= 0 ? "success" : "danger"} />
        <Kpi label="Gross margin YTD" value={pct(k.gross_margin_pct_ytd)} to={`/accounting?tab=is&year=${data.year}`} sub={`${num(k.invoices_ytd)} invoices`} />
        <Kpi label="Open receivables" value={bahtCompact(k.open_ar)} to="/receivables"
          sub={`${bahtCompact(k.overdue_ar)} overdue · ${num(k.open_invoices)} invoices`} tone={k.overdue_ar > 0 ? "warning" : undefined} />
        <Kpi label="Stock value" value={bahtCompact(k.inventory_value)} to="/inventory"
          sub={`${num(k.below_reorder_point)} below reorder point · ${num(k.out_of_stock)} out`} tone={k.out_of_stock > 0 ? "danger" : k.below_reorder_point > 0 ? "warning" : undefined} />
        <Kpi label="Open purchase orders" value={num(k.open_purchase_orders)} to="/purchase-orders?status=OPEN"
          sub={`${baht(k.open_purchase_orders_value)} on order`} />
      </div>

      <div className="mt-9 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Revenue & gross margin by month" description="THB, excl. VAT. Select a month to open its income statement."
            actions={<ChartKey items={[["Revenue", c["chart-1"], "bar"], ["Gross profit", c["chart-3"], "bar"], ["Margin %", c["chart-2"], "line"]]} />} />
          <div className="h-72 px-2 pt-3 pb-1">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.monthly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                onClick={(state) => { const m = state?.activeLabel; if (m) navigate(`/accounting?tab=is&year=${String(m).slice(0, 4)}`); }}>
                <CartesianGrid stroke={c["chart-grid"]} vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fill: c["muted-foreground"], fontSize: 10, fontFamily: "IBM Plex Mono" }} tickLine={false} axisLine={{ stroke: c.foreground }} interval="preserveStartEnd" minTickGap={16} />
                <YAxis yAxisId="v" tickFormatter={(v) => compact(v)} tick={{ fill: c["muted-foreground"], fontSize: 10, fontFamily: "IBM Plex Mono" }} tickLine={false} axisLine={false} width={40} />
                <YAxis yAxisId="p" orientation="right" domain={[0, 40]} tickFormatter={(v) => `${v}%`} tick={{ fill: c["muted-foreground"], fontSize: 10, fontFamily: "IBM Plex Mono" }} tickLine={false} axisLine={false} width={36} />
                <Tooltip cursor={{ fill: c["chart-grid"], opacity: 0.6 }}
                  contentStyle={{ background: c.card, border: `1px solid ${c.foreground}`, borderRadius: 2, fontSize: 12, boxShadow: "none" }}
                  labelStyle={{ color: c.foreground, fontWeight: 600 }}
                  labelFormatter={(l) => monthLabel(String(l))}
                  formatter={(v, name) => [name === "Gross margin %" ? pct(Number(v)) : baht(Number(v)), name]} />
                <Bar yAxisId="v" dataKey="revenue" name="Revenue" fill={c["chart-1"]} barSize={7} isAnimationActive={!reduced} />
                <Bar yAxisId="v" dataKey="gross_profit" name="Gross profit" fill={c["chart-3"]} barSize={7} isAnimationActive={!reduced} />
                <Line yAxisId="p" type="monotone" dataKey="gross_margin_pct" name="Gross margin %" stroke={c["chart-2"]} strokeWidth={1.75} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} isAnimationActive={!reduced} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Receivables ageing" description="Open balance by days past due" actions={<MoreLink to="/receivables" />} />
          <BarList items={data.ar_aging.map((a) => ({
            label: a.bucket === "Current" ? "Not yet due" : `${a.bucket} days`, value: a.amount, sub: `${num(a.invoices)} inv`,
            to: `/receivables?bucket=${encodeURIComponent(a.bucket)}`,
            tone: a.bucket === "Current" ? "ink" : a.bucket === "1-30" ? "stone" : a.bucket === "90+" ? "danger" : "warning",
          }))} />
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader title="Revenue by segment" description={`YTD ${data.year}`} />
          <BarList items={data.revenue_by_segment.map((s) => ({ label: s.segment, value: s.revenue, sub: `${num(s.invoices)} inv`, to: `/customers?segment=${s.segment}` }))} showShare />
        </Card>
        <Card>
          <CardHeader title="Revenue by category" description={`YTD ${data.year}`} />
          <BarList items={data.revenue_by_category.map((s) => ({ label: s.category, value: s.revenue,
            to: `/sales-orders?status=INVOICED&category=${encodeURIComponent(s.category)}&date_from=${data.year}-01-01&date_to=${data.as_of}` }))} showShare />
        </Card>
        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHeader title="Top customers" description={`YTD ${data.year}`} actions={<MoreLink to="/customers" />} />
          <DataTable dense rows={data.top_customers} rowKey={(r) => r.customer_id} rowHref={(r) => `/customers/${r.customer_id}`} caption="Top customers year to date"
            columns={[
              { key: "rank", header: "#", render: (r) => (
                <span className="font-mono text-xs text-muted-foreground">{String(data.top_customers.indexOf(r) + 1).padStart(2, "0")}</span>
              ) },
              { key: "name", header: "Customer", render: (r) => (
                <span className="block min-w-0">
                  <span className="block max-w-56 truncate">{r.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">{r.segment}</span>
                </span>
              ) },
              { key: "revenue", header: "Revenue (THB)", align: "right", render: (r) => (
                <Link to={`/customers?q=${encodeURIComponent(r.name)}`} className="hover:text-accent hover:underline">{money(r.revenue)}</Link>
              ) },
            ]} />
        </Card>
      </div>
    </>
  );
}

const BAR_TONE = { ink: "bg-foreground", stone: "bg-foreground/35", accent: "bg-accent", warning: "bg-warning", danger: "bg-destructive" } as const;

function MoreLink({ to }: { to: string }) {
  return <Link to={to} className="label text-muted-foreground underline-offset-4 hover:text-accent hover:underline">View all →</Link>;
}

/** Inline chart key: sits in the card header so the plot gets the full height. */
function ChartKey({ items }: { items: [string, string, "bar" | "line"][] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map(([label, color, kind]) => (
        <li key={label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={kind === "bar" ? "size-2" : "h-0.5 w-3"} style={{ background: color }} />
          {label}
        </li>
      ))}
    </ul>
  );
}

/** Accessible horizontal bar list — labels and values are real text, bars are decorative. */
function BarList({ items, showShare }: {
  items: { label: string; value: number; sub?: string; to?: string; tone?: keyof typeof BAR_TONE }[]; showShare?: boolean;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const total = items.reduce((a, i) => a + i.value, 0) || 1;
  return (
    <ul className="divide-y divide-dashed px-4 py-1">
      {items.map((i) => {
        const content = (
          <>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>{i.label}</span>
              <span className="num">
                <span className="font-medium">{bahtCompact(i.value)}</span>
                <span className="ml-2 inline-block min-w-[3.25rem] text-right font-mono text-xs text-muted-foreground">
                  {showShare ? pct((i.value / total) * 100, 0) : i.sub}
                </span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 bg-muted" aria-hidden>
              <div className={`h-1.5 ${BAR_TONE[i.tone ?? "ink"]}`} style={{ width: `${Math.max(1, (i.value / max) * 100)}%` }} />
            </div>
          </>
        );
        return (
          <li key={i.label} className="py-2.5">
            {i.to ? <Link to={i.to} className="group block rounded-sm transition-colors duration-150 hover:text-accent">{content}</Link> : content}
          </li>
        );
      })}
    </ul>
  );
}
