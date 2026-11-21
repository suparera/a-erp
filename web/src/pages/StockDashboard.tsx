import { useSearchParams } from "react-router";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DataTable, Pagination } from "../components/DataTable";
import { useChartColors, useReducedMotion } from "../components/theme";
import { Badge, Card, CardHeader, cx, ErrorState, FilterBar, Kpi, PageHeader, PageSkeleton, SearchInput, Select, StatusBadge, Tabs } from "../components/ui";
import { useApi, useMeta, useUrlState, type Paged } from "../lib/api";
import { baht, bahtCompact, compact, date, money, monthLabel, num, pct } from "../lib/format";
import { StockListPage } from "./Inventory";

/** /inventory — Dashboard and Stock list tabs. Switching tabs keeps the shared warehouse / category filters. */
export function InventoryPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") === "list" ? "list" : "dashboard";
  const switchTab = (t: string) => {
    const next = new URLSearchParams();
    for (const k of ["warehouse_id", "category_id"]) if (sp.get(k)) next.set(k, sp.get(k)!);
    if (t === "list") next.set("tab", "list");
    setSp(next);
  };
  return (
    <>
      <PageHeader title="Inventory" description="Stock health across warehouses: value, cover, service level and what needs action. Moving-average cost." />
      <Tabs value={tab} onChange={switchTab} tabs={[{ value: "dashboard", label: "Dashboard" }, { value: "list", label: "Stock list" }]} />
      {tab === "list" ? <StockListPage /> : <StockDashboard />}
    </>
  );
}

interface Dash {
  as_of: string;
  definitions: { cover_low: number; cover_high: number; excess_days: number };
  kpis: {
    stock_value: number; prev_month_value: number; prev_month_end: string; days_of_cover: number | null; turns: number | null;
    fill_rate: number | null; items: number; out: number; at_risk: number; low: number; dead_items: number; dead_value: number;
    excess_items: number; excess_value: number; shrinkage_12m: number;
  };
  trend: ({ month: string; total: number; cogs: number } & Record<string, number | string>)[];
  movements: { month: string; receipts: number; shipments: number; adjustments: number }[];
  warehouses: { warehouse_id: number; code: string; items: number; value: number; turns: number | null; fill_rate: number | null; out: number; at_risk: number; low: number; dead_value: number }[];
  abc_grid: { abc: "A" | "B" | "C"; cover: "low" | "ok" | "high"; items: number; value: number }[];
  shrinkage_top: { product_id: number; sku: string; name: string; warehouse: string; units: number; value: number }[];
}

interface HealthItem {
  id: string; product_id: number; sku: string; name: string; uom: string; category: string; warehouse: string; abc: string;
  on_hand: number; value: number; reorder_point: number; per_day: number; cover_days: number | null; lead_time: number;
  cover_gap: number | null; supplier: string; supplier_on_time: number | null; incoming: number; next_expected: string | null;
  pending_req: number; last_sale: string | null; status: string;
}

const WH_KEYS = ["WH-BKK", "WH-CNX", "WH-KKN"] as const;
const COVER_LABEL = { low: "Low cover", ok: "Healthy", high: "High / no demand" } as const;

function StockDashboard() {
  const { data: meta } = useMeta();
  const [f, set] = useUrlState({ warehouse_id: "", category_id: "", abc: "", view: "risk", cover: "", q: "", sort: "", dir: "", page: "1" });
  const filters = { warehouse_id: f.warehouse_id, category_id: f.category_id, abc: f.abc };
  const { data, error, isLoading } = useApi<Dash>("inventory/dashboard", filters);
  const c = useChartColors();
  const reduced = useReducedMotion();
  if (error) return <ErrorState error={error} />;

  const k = data?.kpis;
  const change = k && k.prev_month_value ? ((k.stock_value - k.prev_month_value) / k.prev_month_value) * 100 : null;
  const whColor: Record<string, string> = { "WH-BKK": c["chart-1"], "WH-CNX": c["chart-2"], "WH-KKN": c["chart-4"] };
  const tooltip = { contentStyle: { background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, fontSize: 12 }, labelStyle: { color: c.foreground, fontWeight: 600 } };
  const axis = { tick: { fill: c["muted-foreground"], fontSize: 11 }, tickLine: false };
  const showList = (view: string, extra: Record<string, string | null> = {}) => {
    set({ view, cover: null, sort: null, dir: null, ...extra });
    document.getElementById("item-health")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  return (
    <>
      <FilterBar>
        <Select label="Warehouse" value={f.warehouse_id} onChange={(e) => set({ warehouse_id: e.target.value })}
          options={[{ value: "", label: "All warehouses" }, ...(meta?.warehouses ?? []).map((w) => ({ value: w.warehouse_id, label: w.code }))]} />
        <Select label="Category" value={f.category_id} onChange={(e) => set({ category_id: e.target.value })}
          options={[{ value: "", label: "All categories" }, ...(meta?.categories ?? []).map((x) => ({ value: x.category_id, label: x.name }))]} />
        <Select label="ABC class" value={f.abc} onChange={(e) => set({ abc: e.target.value })}
          options={[{ value: "", label: "All classes" }, { value: "A", label: "A: top 80% of COGS" }, { value: "B", label: "B: next 15%" }, { value: "C", label: "C: remaining 5%" }]} />
      </FilterBar>

      {isLoading || !data || !k ? <PageSkeleton /> : (
        <>
          <div className="grid grid-cols-2 gap-6 xl:grid-cols-4">
            <Kpi label="Stock value" value={bahtCompact(k.stock_value)}
              sub={change != null ? `${change >= 0 ? "▲" : "▼"} ${pct(Math.abs(change))} vs ${date(k.prev_month_end)}` : undefined} />
            <Kpi label="Days of cover" value={k.days_of_cover != null ? `${k.days_of_cover} days` : "—"} sub="Stock value ÷ avg daily COGS (90 days)" />
            <Kpi label="Stock turns" value={k.turns != null ? `${k.turns}× / yr` : "—"} sub="12-month COGS ÷ stock value" />
            <Kpi label="Fill rate" value={pct(k.fill_rate)} sub="Order lines shipped within 2 days (90 days)"
              tone={k.fill_rate == null ? undefined : k.fill_rate >= 95 ? "success" : k.fill_rate >= 85 ? "warning" : "danger"} />
            <KpiButton label="Out of stock / at risk" value={`${num(k.out)} / ${num(k.at_risk)}`}
              sub="At risk = cover shorter than supplier lead time" tone={k.out + k.at_risk ? "danger" : "success"} onClick={() => showList("risk")} />
            <KpiButton label="Below reorder point" value={num(k.low)} sub="Replenishment due" tone={k.low ? "warning" : "success"} onClick={() => showList("risk")} />
            <KpiButton label="Slow / dead stock" value={bahtCompact(k.dead_value)} sub={`${num(k.dead_items)} items, no sale in 90 days`}
              tone={k.dead_value ? "warning" : "success"} onClick={() => showList("excess", { sort: "value", dir: "desc" })} />
            <KpiButton label={`Overstock (> ${data.definitions.excess_days} days)`} value={bahtCompact(k.excess_value)}
              sub={`${num(k.excess_items)} items`} tone={k.excess_value ? "warning" : "success"} onClick={() => showList("excess", { sort: "value", dir: "desc" })} />
          </div>

          <div className="mt-9 grid gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Stock value by warehouse" description="Month-end value at moving-average cost (stacked)" />
              <div className="h-72 p-2 pr-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.trend} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={c["chart-grid"]} vertical={false} />
                    <XAxis dataKey="month" tickFormatter={monthLabel} {...axis} axisLine={{ stroke: c.border }} minTickGap={16} />
                    <YAxis tickFormatter={(v) => compact(v)} {...axis} axisLine={false} width={44} />
                    <Tooltip {...tooltip} labelFormatter={(l) => monthLabel(String(l))} formatter={(v, n) => [baht(Number(v)), n]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {WH_KEYS.filter((w) => data.trend.some((t) => t[w] != null)).map((w) => (
                      <Area key={w} type="monotone" dataKey={w} name={w} stackId="v" stroke={whColor[w]} fill={whColor[w]} fillOpacity={0.14} strokeWidth={1.5} isAnimationActive={!reduced} />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <CardHeader title="Warehouse comparison" description="Service level vs capital tied up" />
              <WarehouseTable rows={data.warehouses} onPick={(wid) => set({ warehouse_id: String(wid) })} selected={f.warehouse_id} />
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Stock movements" description="Monthly receipts vs shipments at cost (THB); adjustments in the tooltip" />
              <div className="h-64 p-2 pr-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.movements} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={c["chart-grid"]} vertical={false} />
                    <XAxis dataKey="month" tickFormatter={monthLabel} {...axis} axisLine={{ stroke: c.border }} minTickGap={16} />
                    <YAxis tickFormatter={(v) => compact(v)} {...axis} axisLine={false} width={44} />
                    <Tooltip {...tooltip} labelFormatter={(l) => monthLabel(String(l))}
                      formatter={(v, n) => [baht(Number(v)), n]}
                      itemSorter={(i) => (i.dataKey === "receipts" ? 0 : 1)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="receipts" name="Receipts" fill={c["chart-1"]} radius={[2, 2, 0, 0]} isAnimationActive={!reduced} />
                    <Bar dataKey="shipments" name="Shipments (COGS)" fill={c["chart-3"]} radius={[2, 2, 0, 0]} isAnimationActive={!reduced} />
                    <Bar dataKey="adjustments" name="Count adjustments" fill={c.destructive} radius={[2, 2, 0, 0]} isAnimationActive={!reduced} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <CardHeader title="ABC × cover" description={`Cover: low < ${data.definitions.cover_low} days, high > ${data.definitions.cover_high} days. Select a cell to list its items.`} />
              <AbcGrid grid={data.abc_grid} active={f.view === "all" ? { abc: f.abc, cover: f.cover } : null}
                onPick={(abc, cover) => showList("all", { abc, cover, sort: "value", dir: "desc" })} />
            </Card>
          </div>

          <div className="mt-4" id="item-health">
            <Card>
              <ItemHealth f={f} set={set} filters={filters} />
            </Card>
          </div>

          <div className="mt-4">
            <Card>
              <CardHeader title="Top shrinkage" description={`Cycle-count losses, last 12 months · total ${baht(k.shrinkage_12m)}`} />
              <DataTable dense caption="Top shrinkage items" rows={data.shrinkage_top} rowKey={(r) => `${r.product_id}-${r.warehouse}`}
                rowHref={(r) => `/inventory/products/${r.product_id}`}
                columns={[
                  { key: "sku", header: "SKU", render: (r) => <span className="font-mono whitespace-nowrap">{r.sku}</span> },
                  { key: "name", header: "Product", className: "min-w-56" },
                  { key: "warehouse", header: "WH", render: (r) => <span className="font-mono text-xs whitespace-nowrap">{r.warehouse}</span> },
                  { key: "units", header: "Units", align: "right", render: (r) => num(r.units) },
                  { key: "value", header: "Value", align: "right", render: (r) => money(r.value) },
                ]} />
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function KpiButton({ onClick, ...props }: Parameters<typeof Kpi>[0] & { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group block h-full min-w-0 text-left [&>div]:h-full [&>div]:transition-colors [&>div]:duration-150 hover:[&>div]:border-accent">
      <Kpi {...props} />
    </button>
  );
}

function WarehouseTable({ rows, onPick, selected }: { rows: Dash["warehouses"]; onPick: (wid: number) => void; selected: string }) {
  const fillTone = (v: number | null) => (v == null ? "" : v >= 95 ? "text-success" : v >= 85 ? "text-warning" : "text-destructive");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Warehouse comparison</caption>
        <thead>
          <tr className="border-b border-foreground/40 text-muted-foreground">
            {["Warehouse", "Value", "Turns", "Fill rate", "Out / risk"].map((h, i) => (
              <th key={h} scope="col" className={cx("label px-3 py-2", i ? "text-right" : "text-left")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.warehouse_id} className={cx("border-b last:border-0", String(w.warehouse_id) === selected && "bg-accent/[0.07]")}>
              <th scope="row" className="px-3 py-2.5 text-left font-normal">
                <button type="button" onClick={() => onPick(w.warehouse_id)} className="font-mono font-medium text-accent hover:underline">{w.code}</button>
              </th>
              <td className="num px-3 py-2.5 text-right">{bahtCompact(w.value)}</td>
              <td className="num px-3 py-2.5 text-right">{w.turns != null ? `${w.turns}×` : "—"}</td>
              <td className={cx("num px-3 py-2.5 text-right font-medium", fillTone(w.fill_rate))}>{pct(w.fill_rate)}</td>
              <td className="num px-3 py-2.5 text-right">{num(w.out)} / {num(w.at_risk)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">Fill rate colour: ≥ 95% good · ≥ 85% watch · below needs action.</p>
    </div>
  );
}

function AbcGrid({ grid, active, onPick }: {
  grid: Dash["abc_grid"]; active: { abc: string; cover: string } | null; onPick: (abc: string, cover: string) => void;
}) {
  const total = grid.reduce((a, g) => a + g.value, 0) || 1;
  const tint = { low: "var(--destructive)", ok: "var(--success)", high: "var(--warning)" } as const;
  return (
    <div className="overflow-x-auto p-3">
      <table className="w-full border-separate border-spacing-1 text-sm">
        <caption className="sr-only">Items and stock value by ABC class and cover band</caption>
        <thead>
          <tr>
            <th scope="col" className="w-8" />
            {(["low", "ok", "high"] as const).map((b) => <th key={b} scope="col" className="label px-1 pb-1 text-center text-muted-foreground">{COVER_LABEL[b]}</th>)}
          </tr>
        </thead>
        <tbody>
          {(["A", "B", "C"] as const).map((a) => (
            <tr key={a}>
              <th scope="row" className="text-center font-serif text-lg font-medium">{a}</th>
              {(["low", "ok", "high"] as const).map((b) => {
                const g = grid.find((x) => x.abc === a && x.cover === b)!;
                const share = g.value / total;
                const on = active?.abc === a && active?.cover === b;
                return (
                  <td key={b} className="p-0">
                    <button type="button" onClick={() => onPick(a, b)} aria-pressed={on}
                      aria-label={`Class ${a}, ${COVER_LABEL[b]}: ${g.items} items, ${bahtCompact(g.value)}`}
                      className={cx("flex h-16 w-full flex-col items-center justify-center rounded-sm text-center transition-shadow duration-150 hover:ring-1 hover:ring-foreground", on && "ring-2 ring-accent")}
                      style={{ background: `color-mix(in srgb, ${tint[b]} ${Math.round(6 + Math.min(1, share * 3) * 30)}%, transparent)` }}>
                      <span className="num text-base font-semibold">{num(g.items)}</span>
                      <span className="num text-xs text-muted-foreground">{bahtCompact(g.value)}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-1 pt-2 text-xs text-muted-foreground">Class A in "Low cover" is the most urgent; C in "High" is capital to free up.</p>
    </div>
  );
}

function ItemHealth({ f, set, filters }: {
  f: Record<"view" | "cover" | "q" | "sort" | "dir" | "page" | "abc", string>;
  set: (patch: Record<string, string | number | null>, opts?: { resetPage?: boolean }) => void;
  filters: Record<string, string>;
}) {
  const view = (["risk", "excess", "all"].includes(f.view) ? f.view : "risk") as "risk" | "excess" | "all";
  const { data, isLoading, isFetching, error } = useApi<Paged<HealthItem>>("inventory/items", {
    ...filters, view, cover: f.cover, q: f.q, sort: f.sort, dir: f.dir, page: f.page, page_size: 15,
  });
  const title = view === "risk" ? "Needs attention" : view === "excess" ? "Slow & excess stock" : `Class ${f.abc || "all"} · ${COVER_LABEL[(f.cover || "ok") as keyof typeof COVER_LABEL] ?? "all cover"}`;
  const riskCols = [
    { key: "sku", header: "SKU", sortable: true, render: (r: HealthItem) => <span className="font-mono whitespace-nowrap">{r.sku}</span> },
    { key: "name", header: "Product", render: (r: HealthItem) => (
      <div className="min-w-44 max-w-64"><div className="truncate">{r.name}</div><div className="truncate text-xs text-muted-foreground">{r.supplier}</div></div>
    ) },
    { key: "warehouse", header: "WH", sortable: true, render: (r: HealthItem) => <span className="font-mono text-xs whitespace-nowrap">{r.warehouse}</span> },
    { key: "abc", header: "ABC", sortable: true, render: (r: HealthItem) => <Badge tone={r.abc === "A" ? "info" : "neutral"}>{r.abc}</Badge> },
    { key: "on_hand", header: "On hand", align: "right" as const, sortable: true, render: (r: HealthItem) => `${num(r.on_hand)} ${r.uom}` },
    { key: "cover_days", header: "Cover", align: "right" as const, sortable: true, render: (r: HealthItem) => (r.cover_days != null ? `${r.cover_days}d` : "—") },
    { key: "urgency", header: "vs lead time", align: "right" as const, sortable: true, render: (r: HealthItem) => (
      r.status === "out" ? <span className="font-medium text-destructive">Out</span>
        : r.cover_gap == null ? "—" : <span className={cx(r.cover_gap < 0 && "font-medium text-destructive")}>{r.cover_gap > 0 ? "+" : ""}{r.cover_gap}d <span className="text-xs text-muted-foreground">({r.lead_time}d)</span></span>
    ) },
    { key: "incoming", header: "Incoming", align: "right" as const, render: (r: HealthItem) => (
      r.incoming ? <span>{num(r.incoming)}<span className="block text-xs text-muted-foreground">{date(r.next_expected)}</span></span>
        : r.pending_req ? <span className="text-warning">{num(r.pending_req)}<span className="block text-xs">awaiting approval</span></span> : <span className="text-destructive">None</span>
    ) },
    { key: "supplier_on_time", header: "Supplier on-time", align: "right" as const, render: (r: HealthItem) => (
      <span className={cx(r.supplier_on_time != null && r.supplier_on_time < 80 && "text-destructive")}>{pct(r.supplier_on_time, 0)}</span>
    ) },
    { key: "status", header: "Status", render: (r: HealthItem) => <StatusBadge status={r.status} /> },
  ];
  const excessCols = [
    riskCols[0], riskCols[1], riskCols[2], riskCols[3], riskCols[4],
    { key: "value", header: "Value (THB)", align: "right" as const, sortable: true, render: (r: HealthItem) => money(r.value) },
    { key: "cover_days", header: "Cover", align: "right" as const, sortable: true, render: (r: HealthItem) => (r.cover_days != null ? `${num(r.cover_days)}d` : <span className="text-muted-foreground">No demand</span>) },
    { key: "last_sale", header: "Last sale", sortable: true, render: (r: HealthItem) => (r.last_sale ? date(r.last_sale) : <span className="text-muted-foreground">Never</span>) },
    { key: "status", header: "Status", render: (r: HealthItem) => <StatusBadge status={r.status} /> },
  ];
  return (
    <>
      <CardHeader title={title} description={view === "risk" ? "Most urgent first: out of stock, then shortest cover relative to supplier lead time"
        : view === "excess" ? "Most capital tied up first: no sale in 90 days, or more than 120 days of cover" : "Items in the selected ABC × cover cell"}
        actions={<Tabs value={view} onChange={(v) => set({ view: v, cover: null, sort: null, dir: null })}
          tabs={[{ value: "risk", label: "Needs attention" }, { value: "excess", label: "Slow & excess" }, ...(view === "all" ? [{ value: "all", label: "Grid selection" }] : [])]} />} />
      <div className="border-b px-4 py-3">
        <SearchInput value={f.q} onChange={(q) => set({ q })} placeholder="Filter by SKU or product" />
      </div>
      {error ? <div className="p-4"><ErrorState error={error} /></div> : (
        <>
          <DataTable dense caption={title} rows={data?.items} loading={isLoading} fetching={isFetching}
            rowKey={(r) => r.id} rowHref={(r) => `/inventory/products/${r.product_id}`}
            sort={f.sort || (view === "risk" ? "urgency" : "value")} dir={f.dir || (view === "risk" ? "asc" : "desc")}
            onSort={(sort, dir) => set({ sort, dir })}
            columns={view === "risk" ? riskCols : excessCols} />
          {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => set({ page: p })} />}
        </>
      )}
    </>
  );
}
