import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { num } from "../lib/format";
import { cx, EmptyState, Skeleton } from "./ui";

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string | number;
  /** Row navigation target; the first cell also renders a real link for keyboard / screen-reader users. */
  rowHref?: (row: T) => string;
  sort?: string;
  dir?: string;
  onSort?: (key: string, dir: "asc" | "desc") => void;
  loading?: boolean;
  fetching?: boolean;
  footer?: ReactNode;
  caption?: string;
  dense?: boolean;
}

export function DataTable<T>({ columns, rows, rowKey, rowHref, sort, dir, onSort, loading, fetching, footer, caption, dense }: Props<T>) {
  const navigate = useNavigate();
  const pad = dense ? "px-3 py-1.5" : "px-3 py-2";
  return (
    <div className={cx("relative overflow-x-auto transition-opacity duration-150", fetching && "opacity-60")} aria-busy={fetching || loading}>
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-foreground/40">
            {columns.map((c) => {
              const active = sort === c.key;
              const ariaSort = active ? (dir === "asc" ? "ascending" : "descending") : undefined;
              const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <th key={c.key} scope="col" aria-sort={ariaSort}
                  className={cx(pad, "label h-9 whitespace-nowrap text-muted-foreground", c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left")}>
                  {c.sortable && onSort ? (
                    <button type="button" onClick={() => onSort(c.key, active && dir === "desc" ? "asc" : "desc")}
                      className={cx("label inline-flex items-center gap-1 rounded transition-colors duration-150 hover:text-foreground", active && "text-foreground", c.align === "right" && "flex-row-reverse")}>
                      {c.header}
                      <Icon className={cx("size-3", active ? "text-accent" : "opacity-35")} aria-hidden />
                    </button>
                  ) : c.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading && !rows
            ? Array.from({ length: 8 }, (_, i) => (
                <tr key={i} className="border-b last:border-0">
                  {columns.map((c) => <td key={c.key} className={pad}><Skeleton className="h-4 w-full" /></td>)}
                </tr>
              ))
            : rows?.map((row) => {
                const href = rowHref?.(row);
                return (
                  <tr key={rowKey(row)} onClick={href ? (e) => { if (!(e.target as HTMLElement).closest("a,button")) navigate(href); } : undefined}
                    className={cx("border-b transition-colors duration-150 last:border-0", href && "cursor-pointer hover:bg-muted/50")}>
                    {columns.map((c, i) => (
                      <td key={c.key} className={cx(pad, "align-middle", c.align === "right" ? "num text-right whitespace-nowrap" : c.align === "center" ? "text-center" : "", c.className)}>
                        {i === 0 && href ? (
                          <a href={href} onClick={(e) => { e.preventDefault(); navigate(href); }} className="font-medium text-foreground decoration-accent decoration-1 underline-offset-[3px] hover:text-accent hover:underline">
                            {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                          </a>
                        ) : c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "—")}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
        {footer && <tfoot className="border-t-[3px] border-double border-foreground/70 font-semibold">{footer}</tfoot>}
      </table>
      {rows && rows.length === 0 && <EmptyState />}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  const btn = "inline-flex size-8 items-center justify-center rounded-sm border border-foreground/15 bg-card transition-colors duration-150 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-sm text-muted-foreground">
      <span className="num font-mono text-xs">{num(from)}–{num(to)} of {num(total)}</span>
      <div className="flex items-center gap-2">
        <span className="num font-mono text-xs">Page {num(page)} / {num(pages)}</span>
        <button type="button" className={btn} onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <button type="button" className={btn} onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </nav>
  );
}
