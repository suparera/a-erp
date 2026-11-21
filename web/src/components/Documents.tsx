import { Check, Circle } from "lucide-react";
import { Link } from "react-router";
import type { JournalEntry } from "../lib/api";
import { date, money, titleCase } from "../lib/format";
import { Card, CardHeader, cx } from "./ui";

export interface FlowStep {
  label: string;
  number?: string | null;
  date?: string | null;
  detail?: string;
  done: boolean;
}

/** Horizontal document flow (order → delivery → invoice → payment); stacks vertically on small screens. */
export function DocumentFlow({ steps }: { steps: FlowStep[] }) {
  return (
    <Card>
      <CardHeader title="Document flow" />
      <ol className="grid gap-3 p-4 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className={cx("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
              s.done ? "border-foreground bg-foreground text-background" : "border-dashed border-foreground/40 text-muted-foreground")}>
              {s.done ? <Check className="size-3" strokeWidth={3} aria-hidden /> : <Circle className="size-2" aria-hidden />}
            </span>
            <div className="min-w-0 text-sm">
              <div className="font-medium">{s.label}<span className="sr-only">{s.done ? " (completed)" : " (pending)"}</span></div>
              <div className="truncate font-mono text-xs text-muted-foreground">{s.number ?? "Pending"}</div>
              {s.date && <div className="text-xs text-muted-foreground">{date(s.date)}</div>}
              {s.detail && <div className="text-xs text-muted-foreground">{s.detail}</div>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function JournalEntries({ entries }: { entries: JournalEntry[] }) {
  return (
    <Card>
      <CardHeader title="General ledger postings" description={`${entries.length} journal ${entries.length === 1 ? "entry" : "entries"}`} />
      {entries.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">Nothing posted yet.</p>
      ) : (
        <div className="divide-y">
          {entries.map((e) => (
            <div key={e.journal_entry_id} className="px-4 py-3">
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="font-medium">{e.description}</span>
                <span className="text-xs text-muted-foreground">
                  <span className="font-mono">{e.entry_number}</span> · {titleCase(e.source_type)} · {date(e.entry_date)}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sr-only"><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead>
                  <tbody>
                    {e.lines.map((l) => (
                      <tr key={l.line_no}>
                        <td className={cx("py-0.5", l.credit > 0 && "pl-6")}>
                          <Link to={`/accounting/accounts/${l.account_code}`} className="hover:text-accent hover:underline">
                            <span className="font-mono text-xs text-muted-foreground">{l.account_code}</span> {l.account_name}
                          </Link>
                        </td>
                        <td className="num w-32 py-0.5 text-right">{l.debit ? money(l.debit) : ""}</td>
                        <td className="num w-32 py-0.5 text-right">{l.credit ? money(l.credit) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
