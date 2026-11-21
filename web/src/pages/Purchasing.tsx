import { AlertTriangle } from "lucide-react";
import { useParams } from "react-router";
import { DataTable, Pagination } from "../components/DataTable";
import { DocumentFlow, JournalEntries } from "../components/Documents";
import { Badge, Card, CardHeader, cx, DefinitionList, ErrorState, FilterBar, PageHeader, PageSkeleton, SearchInput, Select, StatusBadge } from "../components/ui";
import { useApi, useMeta, useUrlState, type JournalEntry, type Paged } from "../lib/api";
import { baht, date, money, num, titleCase } from "../lib/format";

interface PoRow {
  purchase_order_id: number; po_number: string; order_date: string; expected_date: string; status: string; supplier_name: string;
  warehouse: string; total_amount: number; receipt_date: string | null; deliveries: number | null; line_count: number;
  days_late: number | null; invoices_on_hold: number;
}

export function PurchaseOrdersPage() {
  const { data: meta } = useMeta();
  const [f, set] = useUrlState({ q: "", status: "", supplier_id: "", warehouse_id: "", sort: "order_date", dir: "desc", page: "1" });
  const { data, error, isLoading, isFetching } = useApi<Paged<PoRow>>("purchase-orders", { ...f, page_size: 25 });

  return (
    <>
      <PageHeader title="Purchase Orders" description="Raised from approved requisitions when stock falls below the reorder point; received in one or more deliveries." />
      <FilterBar>
        <SearchInput value={f.q} onChange={(q) => set({ q })} placeholder="PO # or supplier" />
        <Select label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })}
          options={[{ value: "", label: "All statuses" }, { value: "OPEN", label: "Open" }, { value: "PARTIALLY_RECEIVED", label: "Partially received" },
            { value: "RECEIVED", label: "Received" }, { value: "CLOSED_SHORT", label: "Closed short" }]} />
        <Select label="Supplier" value={f.supplier_id} onChange={(e) => set({ supplier_id: e.target.value })}
          options={[{ value: "", label: "All suppliers" }, ...(meta?.suppliers ?? []).map((s) => ({ value: s.supplier_id, label: s.name }))]} />
        <Select label="Warehouse" value={f.warehouse_id} onChange={(e) => set({ warehouse_id: e.target.value })}
          options={[{ value: "", label: "All warehouses" }, ...(meta?.warehouses ?? []).map((w) => ({ value: w.warehouse_id, label: w.code }))]} />
      </FilterBar>
      {error ? <ErrorState error={error} /> : (
        <Card>
          <DataTable caption="Purchase orders" rows={data?.items} loading={isLoading} fetching={isFetching}
            rowKey={(r) => r.purchase_order_id} rowHref={(r) => `/purchase-orders/${r.purchase_order_id}`}
            sort={f.sort} dir={f.dir} onSort={(sort, dir) => set({ sort, dir })}
            columns={[
              { key: "po_number", header: "PO #", sortable: true, render: (r) => <span className="font-mono">{r.po_number}</span> },
              { key: "order_date", header: "Order date", sortable: true, render: (r) => date(r.order_date) },
              { key: "supplier_name", header: "Supplier", sortable: true, render: (r) => <div className="min-w-56">{r.supplier_name}</div> },
              { key: "warehouse", header: "WH", render: (r) => <span className="font-mono text-xs">{r.warehouse}</span> },
              { key: "line_count", header: "Lines", align: "right", render: (r) => num(r.line_count) },
              { key: "total_amount", header: "Total (THB)", align: "right", sortable: true, render: (r) => money(r.total_amount) },
              { key: "expected_date", header: "Expected", sortable: true, render: (r) => date(r.expected_date) },
              { key: "receipt_date", header: "First receipt", render: (r) => r.receipt_date ? (
                <span className="whitespace-nowrap">{date(r.receipt_date)}
                  {r.days_late != null && r.days_late > 0 && <span className="ml-1 text-xs text-warning">+{r.days_late}d</span>}
                  {(r.deliveries ?? 0) > 1 && <span className="ml-1 text-xs text-muted-foreground">· {r.deliveries} deliveries</span>}
                </span>
              ) : "—" },
              { key: "status", header: "Status", sortable: true, render: (r) => (
                <span className="inline-flex flex-wrap gap-1"><StatusBadge status={r.status} />{r.invoices_on_hold > 0 && <Badge tone="danger">Invoice on hold</Badge>}</span>
              ) },
            ]} />
          {data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => set({ page: p })} />}
        </Card>
      )}
    </>
  );
}

interface GrLine { gr_line_id: number; sku: string; product_name: string; quantity_received: number; quantity_rejected: number; quantity_accepted: number; rejection_reason: string | null }
interface SiLine { supplier_invoice_line_id: number; sku: string; product_name: string; quantity_billed: number; unit_price_billed: number; line_amount_billed: number; quantity_accepted: number; po_unit_cost: number; match_result: string }
interface SupplierInvoice {
  supplier_invoice_id: number; document_number: string; supplier_invoice_ref: string; invoice_date: string; due_date: string;
  billed_subtotal: number; billed_total_amount: number; receipt_value: number; match_status: string; exception_type: string | null;
  hold_reason: string | null; resolution: string | null; approved_date: string | null; approved_by_name: string | null;
  subtotal: number | null; total_amount: number | null; price_variance: number | null; status: string;
  lines: SiLine[]; payments: { supplier_payment_id: number; payment_number: string; payment_date: string; amount: number; method: string }[];
}
interface PoDetail extends PoRow {
  supplier_code: string; payment_terms_days: number; lead_time_days: number; buyer: string; warehouse_name: string; subtotal: number; vat_amount: number;
  lines: { po_line_id: number; line_no: number; product_id: number; sku: string; product_name: string; uom: string; quantity: number; received_quantity: number; unit_cost: number; line_amount: number }[];
  requisition: { requisition_number: string; source: string; request_date: string; requested_by_name: string; estimated_amount: number;
    approval_level: string; approver_name: string | null; approver_title: string | null; decision_date: string | null };
  goods_receipts: { goods_receipt_id: number; gr_number: string; delivery_no: number; receipt_date: string; received_by_name: string; lines: GrLine[] }[];
  supplier_invoices: SupplierInvoice[];
  journal_entries: JournalEntry[];
}

export function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const { data: po, error, isLoading } = useApi<PoDetail>(`purchase-orders/${id}`);
  if (error) return <ErrorState error={error} />;
  if (isLoading || !po) return <PageSkeleton />;
  const req = po.requisition;
  const grs = po.goods_receipts, sis = po.supplier_invoices;
  const lastGr = grs.at(-1), lastSi = sis.at(-1);
  const pays = sis.flatMap((s) => s.payments);
  const onHold = sis.filter((s) => s.status === "ON_HOLD");
  const allPaid = sis.length > 0 && sis.every((s) => s.status === "PAID") && ["RECEIVED", "CLOSED_SHORT"].includes(po.status);

  return (
    <>
      <PageHeader back={{ to: "/purchase-orders", label: "Purchase orders" }} title={<span className="font-mono">{po.po_number}</span>}
        badge={<StatusBadge status={po.status} />} description={`${po.supplier_name} · ordered ${date(po.order_date)}`} />
      {onHold.length > 0 && (
        <div role="alert" className="mb-6 flex items-start gap-2 border-l-2 border-destructive bg-destructive/[0.06] px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div><span className="font-medium text-destructive">Invoice on hold: </span>{onHold.map((s) => `${s.document_number}: ${s.hold_reason}`).join(" · ")}</div>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <DocumentFlow steps={[
            { label: "Requisition", number: req.requisition_number, date: req.request_date, detail: titleCase(req.source), done: true },
            { label: "Approval", number: req.approval_level === "AUTO" ? "Auto-approved" : req.approver_name, date: req.decision_date, detail: req.approver_title ?? "Under ฿50k limit", done: true },
            { label: "Purchase order", number: po.po_number, date: po.order_date, detail: `Expected ${date(po.expected_date)}`, done: true },
            { label: grs.length > 1 ? `Goods receipts (${grs.length})` : "Goods receipt", number: lastGr?.gr_number, date: lastGr?.receipt_date, done: ["RECEIVED", "CLOSED_SHORT"].includes(po.status) },
            { label: "Invoice match", number: lastSi?.document_number, date: lastSi?.approved_date ?? lastSi?.invoice_date,
              detail: lastSi ? titleCase(lastSi.match_status) : undefined, done: sis.length > 0 && onHold.length === 0 },
            { label: "Payment", number: pays.at(-1)?.payment_number, date: pays.at(-1)?.payment_date, done: allPaid },
          ]} />

          <Card>
            <CardHeader title="Lines" description="Ordered vs accepted into stock (rejected units excluded)." />
            <DataTable caption="Purchase order lines" rows={po.lines} rowKey={(l) => l.po_line_id} rowHref={(l) => `/inventory/products/${l.product_id}`}
              columns={[
                { key: "sku", header: "SKU", render: (l) => <span className="font-mono text-xs">{l.sku}</span> },
                { key: "product_name", header: "Product", className: "min-w-56" },
                { key: "quantity", header: "Ordered", align: "right", render: (l) => `${num(l.quantity)} ${l.uom}` },
                { key: "received_quantity", header: "Accepted", align: "right", render: (l) => (
                  <span className={cx(grs.length > 0 && l.received_quantity < l.quantity && "font-medium text-warning")}>{grs.length ? num(l.received_quantity) : "—"}</span>
                ) },
                { key: "unit_cost", header: "PO price", align: "right", render: (l) => money(l.unit_cost) },
                { key: "line_amount", header: "Amount", align: "right", render: (l) => money(l.line_amount) },
              ]}
              footer={<tr><td colSpan={5} className="px-3 py-1.5 text-right">Total incl. VAT (THB)</td><td className="num px-3 py-1.5 text-right">{money(po.total_amount)}</td></tr>} />
          </Card>

          {grs.map((g) => (
            <Card key={g.goods_receipt_id}>
              <CardHeader title={`Delivery ${g.delivery_no} · ${g.gr_number}`} description={`Received ${date(g.receipt_date)} by ${g.received_by_name}`} />
              <DataTable dense caption={`Goods receipt ${g.gr_number}`} rows={g.lines} rowKey={(l) => l.gr_line_id}
                columns={[
                  { key: "sku", header: "SKU", render: (l) => <span className="font-mono text-xs">{l.sku}</span> },
                  { key: "product_name", header: "Product", className: "min-w-48" },
                  { key: "quantity_received", header: "Delivered", align: "right", render: (l) => num(l.quantity_received) },
                  { key: "quantity_rejected", header: "Rejected", align: "right", render: (l) => l.quantity_rejected ? <span className="text-destructive">{num(l.quantity_rejected)}</span> : "—" },
                  { key: "quantity_accepted", header: "Accepted", align: "right", render: (l) => num(l.quantity_accepted) },
                  { key: "rejection_reason", header: "Reason", render: (l) => l.rejection_reason ?? "" },
                ]} />
            </Card>
          ))}

          {sis.map((s) => <InvoiceMatchCard key={s.supplier_invoice_id} si={s} />)}
          <JournalEntries entries={po.journal_entries} />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Order details" />
            <DefinitionList items={[
              ["Supplier", po.supplier_code], ["Buyer", po.buyer], ["Ship to", po.warehouse_name],
              ["Supplier lead time", `${po.lead_time_days} days`], ["Payment terms", `${po.payment_terms_days} days`],
              ["Subtotal", baht(po.subtotal)], ["VAT", baht(po.vat_amount)],
            ]} />
          </Card>
          <Card>
            <CardHeader title="Requisition & approval" />
            <DefinitionList items={[
              ["Requisition", <span key="r" className="font-mono">{req.requisition_number}</span>],
              ["Source", req.source === "EMERGENCY" ? <Badge key="s" tone="warning">Emergency buy</Badge> : "Reorder point"],
              ["Requested by", req.requested_by_name],
              ["Estimated value", baht(req.estimated_amount)],
              ["Approval level", titleCase(req.approval_level)],
              ["Approved by", req.approver_name ?? "System (auto)"],
              ["Decision", date(req.decision_date)],
            ]} />
          </Card>
        </div>
      </div>
    </>
  );
}

const MATCH_TONE = { MATCHED: "success", WITHIN_TOLERANCE: "info", EXCEPTION: "danger" } as const;

function InvoiceMatchCard({ si }: { si: SupplierInvoice }) {
  const variance = si.billed_subtotal - si.receipt_value;
  return (
    <Card>
      <CardHeader title={`Supplier invoice ${si.document_number}`}
        description={`Supplier ref ${si.supplier_invoice_ref} · invoiced ${date(si.invoice_date)} · due ${date(si.due_date)}`}
        actions={<span className="inline-flex gap-1"><Badge tone={MATCH_TONE[si.match_status as keyof typeof MATCH_TONE]}>{titleCase(si.match_status)}</Badge><StatusBadge status={si.status} /></span>} />
      <div className="grid gap-px border-b bg-border text-sm sm:grid-cols-3">
        {[
          ["Billed (excl. VAT)", money(si.billed_subtotal)],
          ["Goods receipt value", money(si.receipt_value)],
          ["Difference", <span key="d" className={cx(Math.abs(variance) > 0.005 && "font-semibold text-destructive")}>{variance > 0 ? "+" : ""}{money(variance)}</span>],
        ].map(([k, v]) => (
          <div key={String(k)} className="bg-card px-4 py-2.5"><div className="text-xs text-muted-foreground">{k}</div><div className="num font-medium">{v}</div></div>
        ))}
      </div>
      <DataTable dense caption="Three-way match lines" rows={si.lines} rowKey={(l) => l.supplier_invoice_line_id}
        columns={[
          { key: "sku", header: "SKU", render: (l) => <span className="font-mono text-xs">{l.sku}</span> },
          { key: "quantity_billed", header: "Billed qty", align: "right", render: (l) => <span className={cx(l.quantity_billed !== l.quantity_accepted && "font-semibold text-destructive")}>{num(l.quantity_billed)}</span> },
          { key: "quantity_accepted", header: "Accepted qty", align: "right", render: (l) => num(l.quantity_accepted) },
          { key: "unit_price_billed", header: "Billed price", align: "right", render: (l) => <span className={cx(l.unit_price_billed !== l.po_unit_cost && "font-semibold text-destructive")}>{money(l.unit_price_billed)}</span> },
          { key: "po_unit_cost", header: "PO price", align: "right", render: (l) => money(l.po_unit_cost) },
          { key: "match_result", header: "Result", render: (l) => <Badge tone={l.match_result === "OK" ? "success" : "danger"}>{l.match_result === "OK" ? "OK" : titleCase(l.match_result)}</Badge> },
        ]} />
      <div className="border-t px-4 py-3 text-sm">
        {si.status === "ON_HOLD" ? (
          <p><span className="font-medium text-destructive">On hold:</span> {si.hold_reason}. Waiting for the buyer or a supplier credit note.</p>
        ) : (
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">{titleCase(si.resolution ?? "")}</span>
            {si.approved_by_name && <> by {si.approved_by_name}</>} on {date(si.approved_date)} · payable {baht(si.total_amount)}
            {si.price_variance ? <> · price variance <span className="num font-medium text-foreground">{money(si.price_variance)}</span> posted to 5200</> : null}
            {si.payments.length > 0 && <> · paid {date(si.payments.at(-1)!.payment_date)}</>}
          </p>
        )}
      </div>
    </Card>
  );
}
