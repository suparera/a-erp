import { Banknote, Boxes, Percent, TrendingUp, Truck } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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

  return (
    <>
      <PageHeader title="Managing Director" description={`Morning overview · Year to date ${data.year} · 1 Jan – ${date(data.as_of)}`} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Revenue YTD (excl. VAT)" icon={TrendingUp} value={bahtCompact(k.revenue_ytd)} to={`/accounting?tab=is&year=${data.year}`}
          sub={growth != null ? `${growth >= 0 ? "▲" : "▼"} ${pct(Math.abs(growth))} vs same period ${data.year - 1}` : undefined}
          tone={growth != null && growth >= 0 ? "success" : "danger"} />
        <Kpi label="Gross margin YTD" icon={Percent} value={pct(k.gross_margin_pct_ytd)} to={`/accounting?tab=is&year=${data.year}`} sub={`${num(k.invoices_ytd)} invoices`} />
        <Kpi label="Open receivables" icon={Banknote} value={bahtCompact(k.open_ar)} to="/receivables"
          sub={`${bahtCompact(k.overdue_ar)} overdue · ${num(k.open_invoices)} invoices`} tone={k.overdue_ar > 0 ? "warning" : undefined} />
        <Kpi label="Stock value" icon={Boxes} value={bahtCompact(k.inventory_value)} to="/inventory"
          sub={`${num(k.below_reorder_point)} below reorder point · ${num(k.out_of_stock)} out`} tone={k.out_of_stock > 0 ? "danger" : k.below_reorder_point > 0 ? "warning" : undefined} />
        <Kpi label="Open purchase orders" icon={Truck} value={num(k.open_purchase_orders)} to="/purchase-orders?status=OPEN"
          sub={`${baht(k.open_purchase_orders_value)} on order`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Monthly revenue & gross margin" description="Revenue and gross profit (THB, bars) with gross margin % (line)" />
          <div className="h-72 p-2 pr-0">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.monthly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                onClick={(state) => { const m = state?.activeLabel; if (m) navigate(`/accounting?tab=is&year=${String(m).slice(0, 4)}`); }}>
                <CartesianGrid stroke={c["chart-grid"]} vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fill: c["muted-foreground"], fontSize: 11 }} tickLine={false} axisLine={{ stroke: c.border }} interval="preserveStartEnd" minTickGap={16} />
                <YAxis yAxisId="v" tickFormatter={(v) => compact(v)} tick={{ fill: c["muted-foreground"], fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
                <YAxis yAxisId="p" orientation="right" domain={[0, 40]} tickFormatter={(v) => `${v}%`} tick={{ fill: c["muted-foreground"], fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                <Tooltip
                  contentStyle={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: c.foreground, fontWeight: 600 }}
                  labelFormatter={(l) => monthLabel(String(l))}
                  formatter={(v, name) => [name === "Gross margin %" ? pct(Number(v)) : baht(Number(v)), name]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="v" dataKey="revenue" name="Revenue" fill={c["chart-1"]} radius={[2, 2, 0, 0]} isAnimationActive={!reduced} />
                <Bar yAxisId="v" dataKey="gross_profit" name="Gross profit" fill={c["chart-3"]} radius={[2, 2, 0, 0]} isAnimationActive={!reduced} />
                <Line yAxisId="p" dataKey="gross_margin_pct" name="Gross margin %" stroke={c["chart-2"]} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} isAnimationActive={!reduced} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Receivables ageing" description="Open balance by days past due" actions={<Link to="/receivables" className="text-xs font-medium text-accent hover:underline">View all</Link>} />
          <BarList items={data.ar_aging.map((a) => ({
            label: a.bucket === "Current" ? "Not yet due" : `${a.bucket} days`, value: a.amount, sub: `${num(a.invoices)} inv`,
            to: `/receivables?bucket=${encodeURIComponent(a.bucket)}`,
            tone: a.bucket === "Current" ? "success" : a.bucket === "1-30" ? "accent" : a.bucket === "90+" ? "danger" : "warning",
          }))} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
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
          <CardHeader title="Top customers" description={`YTD ${data.year}`} actions={<Link to="/customers" className="text-xs font-medium text-accent hover:underline">View all</Link>} />
          <DataTable dense rows={data.top_customers} rowKey={(r) => r.customer_id} rowHref={(r) => `/customers/${r.customer_id}`} caption="Top customers year to date"
            columns={[
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

const BAR_TONE = { accent: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-destructive" } as const;

/** Accessible horizontal bar list — labels and values are real text, bars are decorative. */
function BarList({ items, showShare }: {
  items: { label: string; value: number; sub?: string; to?: string; tone?: keyof typeof BAR_TONE }[]; showShare?: boolean;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const total = items.reduce((a, i) => a + i.value, 0) || 1;
  return (
    <ul className="space-y-3 p-4">
      {items.map((i) => {
        const content = (
          <>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{i.label}</span>
              <span className="num text-muted-foreground">
                <span className="font-medium text-foreground">{bahtCompact(i.value)}</span>
                {showShare && ` · ${pct((i.value / total) * 100, 0)}`}
                {i.sub && ` · ${i.sub}`}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-muted" aria-hidden>
              <div className={`h-2 rounded-full ${BAR_TONE[i.tone ?? "accent"]}`} style={{ width: `${Math.max(1, (i.value / max) * 100)}%` }} />
            </div>
          </>
        );
        return (
          <li key={i.label}>
            {i.to ? <Link to={i.to} className="block rounded transition-opacity duration-150 hover:opacity-80">{content}</Link> : content}
          </li>
        );
      })}
    </ul>
  );
}
