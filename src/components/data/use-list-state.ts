"use client";

import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { useCallback, useMemo } from "react";
import type { FilterValue, SortSpec } from "./types";

/**
 * Screen 79, rule two: the filter lives in the address. Paste the link into an
 * email and the other person sees the same rows — if their permissions allow.
 *
 * Encoding: `stage:a|b,owner:me` — AND between fields, OR inside one.
 */
export function encodeFilter(filter: FilterValue): string {
  return Object.entries(filter)
    .filter(([, values]) => values.length > 0)
    .map(([key, values]) => `${key}:${values.join("|")}`)
    .join(",");
}

export function decodeFilter(raw: string): FilterValue {
  if (!raw) return {};
  const out: FilterValue = {};
  for (const part of raw.split(",")) {
    const [key, values] = part.split(":");
    if (!key || !values) continue;
    out[key] = values.split("|").filter(Boolean);
  }
  return out;
}

export function useListState(defaultPageSize = 25) {
  const [state, setState] = useQueryStates(
    {
      f: parseAsString.withDefault(""),
      sort: parseAsString.withDefault(""),
      page: parseAsInteger.withDefault(1),
      size: parseAsInteger.withDefault(defaultPageSize),
    },
    { history: "push", clearOnDefault: true },
  );

  const filter = useMemo(() => decodeFilter(state.f), [state.f]);

  const sort = useMemo<SortSpec>(() => {
    if (!state.sort) return null;
    const desc = state.sort.startsWith("-");
    return { key: desc ? state.sort.slice(1) : state.sort, direction: desc ? "desc" : "asc" };
  }, [state.sort]);

  const setFilter = useCallback(
    (next: FilterValue) => setState({ f: encodeFilter(next) || null, page: 1 }),
    [setState],
  );

  const setSort = useCallback(
    (next: SortSpec) =>
      setState({ sort: next ? `${next.direction === "desc" ? "-" : ""}${next.key}` : null }),
    [setState],
  );

  const clearAll = useCallback(() => setState({ f: null, page: 1 }), [setState]);

  return {
    filter,
    sort,
    page: state.page,
    pageSize: state.size,
    setFilter,
    setSort,
    setPage: (page: number) => setState({ page }),
    setPageSize: (size: number) => setState({ size, page: 1 }),
    clearAll,
  };
}
