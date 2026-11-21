import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { authenticatedFetch, UNAUTHORIZED_EVENT } from "./auth";

export type Params = Record<string, string | number | boolean | null | undefined>;

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, params?: Params): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  // Session travels as an HttpOnly cookie (same-origin via the Vite proxy / API-served build)
  const res = await authenticatedFetch(`/api/${path}${qs.size ? `?${qs}` : ""}`);
  if (res.status === 401) dispatchEvent(new Event(UNAUTHORIZED_EVENT)); // expired session → login page
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json() as Promise<T>;
}

/** GET an API path; keeps showing the previous result while new filters load (no layout jump). */
export function useApi<T>(path: string | null, params?: Params) {
  return useQuery({
    queryKey: [path, params],
    queryFn: () => api<T>(path!, params),
    enabled: path !== null,
    placeholderData: keepPreviousData,
  });
}

/** Filter / sort / page state kept in the URL so every view is deep-linkable and survives Back. */
export function useUrlState<K extends string>(defaults: Record<K, string>) {
  const [sp, setSp] = useSearchParams();
  const values = Object.fromEntries(
    (Object.keys(defaults) as K[]).map((k) => [k, sp.get(k) ?? defaults[k]]),
  ) as Record<K, string>;

  const set = useCallback(
    (patch: Partial<Record<K, string | number | null>>, opts: { resetPage?: boolean } = {}) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch) as [string, string | number | null][]) {
            const d = (defaults as Record<string, string>)[k];
            if (v === null || v === "" || String(v) === d) next.delete(k);
            else next.set(k, String(v));
          }
          if (opts.resetPage ?? !("page" in patch)) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    // `defaults` is a literal at each call site, so it is deliberately not a dependency
    [setSp],
  );
  return [values, set] as const;
}

export interface Meta {
  as_of: string;
  company: { name: string; tax_id: string; currency: string; vat_rate: number; address: string };
  warehouses: { warehouse_id: number; code: string; name: string }[];
  categories: { category_id: number; code: string; name: string }[];
  suppliers: { supplier_id: number; supplier_code: string; name: string }[];
  segments: string[];
  regions: string[];
}

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("meta"), staleTime: Infinity });
}

export interface JournalEntry {
  journal_entry_id: number;
  entry_number: string;
  entry_date: string;
  source_type: string;
  description: string;
  lines: { line_no: number; account_code: string; account_name: string; debit: number; credit: number }[];
}
