import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useParams } from "react-router";
import { DataTable, Pagination } from "../components/DataTable";
import { useChartColors, useReducedMotion } from "../components/theme";
import { Badge, Card, CardHeader, cx, DefinitionList, ErrorState, FilterBar, Kpi, PageHeader, PageSkeleton, SearchInput, Select, StatusBadge } from "../components/ui";
import { useApi, useMeta, useUrlState, type Paged } from "../lib/api";
import { baht, bahtCompact, date, money, monthLabel, num, titleCase } from "../lib/format";

interface StockRow {
  id: string; product_id: number; sku: string; name: string; brand: string; uom: string; category: string; warehouse: string;
  on_hand: number; on_order: number; reorder_point: number; reorder_qty: number; value: number; avg_cost: number | null;
  list_price: number; is_active: number; stock_status: string;
}

/** Stock list tab: every item × warehouse with on-hand, reorder point and value. */
export function StockListPage() {
  const { data: meta } = useMeta();
  const [f, set] = useUrlState({ q: "", warehouse_id: "", category_id: "", stock_status: "", sort: "value", dir: "desc", page: "1" });
  const { data, error, isLoading, isFetching } = useApi<Paged<StockRow> & { summary: { item_locations: number; value: number; out_of_stock: number; low: number } }>(
    "inventory", { ...f, page_size: 25 });
  const s = data?.summary;

  return (
    <>
      <div className="mb-8 grid grid-cols-2 gap-6 xl:grid-cols-4">
        <Kpi label="Stock value (filtered)" value={s ? bahtCompact(s.value) : "—"} />
        <Kpi label="Item-locations" value={s ? num(s.item_locations) : "—"} />
        <Kpi label="Below reorder point" value={s ? num(s.low) : "—"} tone={s?.low ? "warning" : "success"} sub={s?.low ? "Replenishment pending" : "All above reorder point"} to="?tab=list&stock_status=low" />
        <Kpi label="Out of stock" value={s ? num(s.out_of_stock) : "—"} tone={s?.out_of_stock ? "danger" : "success"} sub={s?.out_of_stock ? "Blocking order shipments" : "Nothing blocked"} to="?tab=list&stock_status=out" />
      </div>
      <FilterBar>
        <SearchInput value={f.q} onChange={(q) => set({ q })} placeholder="SKU, product or brand" />
        <Select label="Warehouse" value={f.warehouse_id} onChange={(e) => set({ warehouse_id: e.target.value })}
          options={[{ value: "", label: "All warehouses" }, ...(meta?.warehouses ?? []).map((w) => ({ value: w.warehouse_id, label: w.code }))]} />
        <Select label="Category" value={f.category_id} onChange={(e) => set({ category_id: e.target.value })}
          options={[{ value: "", label: "All categories" }, ...(meta?.categories ?? []).map((c) => ({ value: c.category_id, label: c.name }))]} />
        <Select label="Stock status" value={f.stock_status} onChange={(e) => set({ stock_status: e.target.value })}
          options={[{ value: "", label: "Any status" }, { value: "ok", label: "In stock" }, { value: "low", label: "Below ROP" }, { value: "out", label: "Out of stock" }]} />
      </FilterBar>
      {error ? <ErrorState error={error} /> : (
        <Card>
          <DataTable caption="Stock by item and warehouse" rows={data?.items} loading={isLoading} fetching={isFetching}
            rowKey={(r) => r.id} rowHref={(r) => `/inventory/products/${r.product_id}`}
            sort={f.sort} dir={f.dir} onSort={(sort, dir) => set({ sort, dir })}
            columns={[
              { key: "sku", header: "SKU", sortable: true, render: (r) => <span className="font-mono">{r.sku}</span> },
              { key: "name", header: "Product", sortable: true, render: (r) => <div className="min-w-56">{r.name}</div> },
              { key: "category", header: "Category", sortable: true, render: (r) => <span className="whitespace-nowrap">{r.category}</span> },
              { key: "warehouse", header: "WH", sortable: true, render: (r) => <span className="font-mono text-xs">{r.warehouse}</span> },
              { key: "on_hand", header: "On hand", align: "right", sortable: true, render: (r) => <span className={cx(r.on_hand <= 0 && "text-destructive", r.on_hand > 0 && r.on_hand < r.reorder_point && "text-warning")}>{num(r.on_hand)} <span className="text-xs text-muted-foreground">{r.uom}</span></span> },
              { key: "on_order", header: "On order", align: "right", sortable: true, render: (r) => (r.on_order ? num(r.on_order) : "—") },
              { key: "reorder_point", header: "ROP", align: "right", sortable: true, render: (r) => num(r.reorder_point) },
              { key: "avg_cost", header: "Avg cost", align: "right", render: (r) => money(r.avg_cost) },
              { key: "value", header: "Value (THB)", align: "right", sortable: true, render: (r) => money(r.value) },
              { key: "stock_status", header: "Status", render: (r) => <StatusBadge status={r.stock_status} /> },
            ]} />
          {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => set({ page: p })} />}
        </Card>
      )}
    </>
  );
}

interface ProductDetail {
  product_id: number; sku: string; name: string; brand: string; category: string; uom: string; standard_cost: number; list_price: number;
  supplier_name: string; lead_time_days: number; created_date: string; discontinued_date: string | null; is_active: number;
  prices: { product_price_id: number; valid_from: string; valid_to: string | null; list_price: number; standard_cost: number }[];
  stock: { warehouse_id: number; warehouse: string; on_hand: number; on_order: number; reorder_point: number; reorder_qty: number; value: number }[];
  monthly_sales: { month: string; quantity: number; revenue: number }[];
  recent_movements: { inventory_txn_id: number; txn_date: string; warehouse: string; txn_type: string; quantity: number; unit_cost: number; total_cost: number; reference_type: string | null }[];
}

export function ProductDetailPage() {
  const { id } = useParams();
  const { data: p, error, isLoading } = useApi<ProductDetail>(`products/${id}`);
  const c = useChartColors();
  const reduced = useReducedMotion();
  if (error) return <ErrorState error={error} />;
  if (isLoading || !p) return <PageSkeleton />;
  const margin = ((p.list_price - p.standard_cost) / p.list_price) * 100;

  return (
    <>
      <PageHeader back={{ to: "/inventory", label: "Inventory" }} title={p.name}
        badge={p.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Discontinued {date(p.discontinued_date)}</Badge>}
        description={<><span className="font-mono">{p.sku}</span> · {p.category} · {p.brand}</>} />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Units sold per month" description="Invoiced orders, all warehouses" />
          <div className="h-64 p-2 pr-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={p.monthly_sales} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c["chart-grid"]} vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fill: c["muted-foreground"], fontSize: 11 }} tickLine={false} axisLine={{ stroke: c.border }} minTickGap={16} />
                <YAxis tick={{ fill: c["muted-foreground"], fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                <Tooltip contentStyle={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: c.foreground, fontWeight: 600 }} labelFormatter={(l) => monthLabel(String(l))}
                  formatter={(v) => [`${num(Number(v))} ${p.uom}`, "Units"]} />
                <Bar dataKey="quantity" fill={c["chart-1"]} radius={[2, 2, 0, 0]} isAnimationActive={!reduced} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHeader title="Product" />
          <DefinitionList items={[
            ["List price", baht(p.list_price)], ["Standard cost", baht(p.standard_cost)],
            ["List margin", `${margin.toFixed(1)}%`], ["Unit", p.uom], ["Primary supplier", p.supplier_name],
            ["Supplier lead time", `${p.lead_time_days} days`], ["Created", date(p.created_date)],
          ]} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Stock by warehouse" />
          <DataTable dense caption="Stock by warehouse" rows={p.stock} rowKey={(r) => r.warehouse_id}
            columns={[
              { key: "warehouse", header: "Warehouse", render: (r) => <span className="font-mono">{r.warehouse}</span> },
              { key: "on_hand", header: "On hand", align: "right", render: (r) => num(r.on_hand) },
              { key: "on_order", header: "On order", align: "right", render: (r) => num(r.on_order) },
              { key: "reorder_point", header: "ROP", align: "right", render: (r) => num(r.reorder_point) },
              { key: "reorder_qty", header: "Reorder qty", align: "right", render: (r) => num(r.reorder_qty) },
              { key: "value", header: "Value", align: "right", render: (r) => money(r.value) },
            ]} />
        </Card>
        <Card>
          <CardHeader title="Price list history" />
          <DataTable dense caption="Price history" rows={p.prices} rowKey={(r) => r.product_price_id}
            columns={[
              { key: "valid_from", header: "Valid from", render: (r) => date(r.valid_from) },
              { key: "valid_to", header: "Valid to", render: (r) => (r.valid_to ? date(r.valid_to) : <Badge tone="info">Current</Badge>) },
              { key: "list_price", header: "List price", align: "right", render: (r) => money(r.list_price) },
              { key: "standard_cost", header: "Std cost", align: "right", render: (r) => money(r.standard_cost) },
            ]} />
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Recent stock movements" description="Latest 25 inventory transactions" />
          <DataTable dense caption="Stock movements" rows={p.recent_movements} rowKey={(r) => r.inventory_txn_id}
            columns={[
              { key: "txn_date", header: "Date", render: (r) => date(r.txn_date) },
              { key: "warehouse", header: "WH", render: (r) => <span className="font-mono text-xs">{r.warehouse}</span> },
              { key: "txn_type", header: "Type", render: (r) => <Badge tone={r.quantity > 0 ? "success" : "neutral"}>{titleCase(r.txn_type)}</Badge> },
              { key: "quantity", header: "Qty", align: "right", render: (r) => <span className={r.quantity > 0 ? "text-success" : ""}>{r.quantity > 0 ? "+" : ""}{num(r.quantity)}</span> },
              { key: "unit_cost", header: "Unit cost", align: "right", render: (r) => money(r.unit_cost) },
              { key: "total_cost", header: "Value", align: "right", render: (r) => money(r.total_cost) },
            ]} />
        </Card>
      </div>
    </>
  );
}
