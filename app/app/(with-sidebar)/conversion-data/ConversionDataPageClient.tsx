"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ignoreAbortRejection, isAbortError, safeAbortController } from "@/app/lib/abortUtils";

type TabId = "registrations" | "purchases";

type ConversionRow = {
  id: string;
  event_time: string | null;
  created_at: string | null;
  event_name: string;
  external_event_id: string | null;
  user_external_id: string | null;
  value: number | null;
  currency: string | null;
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  visitor_id: string | null;
  click_id: string | null;
  metadata: Record<string, unknown> | null;
  email: string | null;
  phone: string | null;
};

type ApiResponse = {
  success: boolean;
  items: ConversionRow[];
  total: number;
  page: number;
  page_size: number;
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function cell(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function DetailValue({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="grid grid-cols-[minmax(0,120px)_1fr] gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(0,140px)_1fr]">
      <span className="text-neutral-500">{label}:</span>
      <span className="min-w-0 truncate font-mono text-[11px] text-neutral-300">{cell(value)}</span>
    </div>
  );
}

export default function ConversionDataPageClient() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? null;

  const [activeTab, setActiveTab] = useState<TabId>("registrations");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [inputSearch, setInputSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ConversionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [activeTab, pageSize, search]);

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const eventName = activeTab === "registrations" ? "registration" : "purchase";
        const params = new URLSearchParams({
          project_id: projectId,
          event_name: eventName,
          page: String(page),
          page_size: String(pageSize),
        });
        if (search.trim()) params.set("search", search.trim());
        const res = await fetch(`/api/conversion-events?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (controller.signal.aborted) return;
        const json = (await res.json()) as ApiResponse & { error?: string };
        if (controller.signal.aborted) return;
        if (!res.ok || !json.success) {
          setError(json.error ?? "Failed to load events");
          setRows([]);
          setTotal(0);
          return;
        }
        setRows(json.items ?? []);
        setTotal(json.total ?? 0);
      } catch (e) {
        if (isAbortError(e)) return;
        setError("Failed to load events");
        setRows([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    };
    ignoreAbortRejection(load(), "conversion-events");
    return () => safeAbortController(controller);
  }, [projectId, activeTab, page, pageSize, search]);

  const totalPages = useMemo(() => {
    if (!total) return 1;
    return Math.max(1, Math.ceil(total / pageSize));
  }, [total, pageSize]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(inputSearch);
  };

  if (!projectId) {
    return (
      <div className="flex min-h-[280px] items-center justify-center p-6">
        <div className="text-center">
          <div className="text-base font-semibold text-neutral-300">Проект не выбран</div>
          <div className="mt-2 text-sm text-neutral-500">
            <code className="rounded bg-neutral-800 px-2 py-1 text-neutral-400">?project_id=ID</code>
          </div>
        </div>
      </div>
    );
  }

  const isRegistrations = activeTab === "registrations";
  const emptyText = isRegistrations ? "No registration events found" : "No purchase events found";

  return (
    <div className="mx-auto w-full max-w-7xl p-6 pb-12">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Conversion Data</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Просматривайте все входящие события регистраций и покупок по текущему проекту.
          </p>
        </div>
      </div>

      {/* Tabs + controls */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-neutral-900/80 p-1 ring-1 ring-neutral-800">
          <button
            type="button"
            onClick={() => setActiveTab("registrations")}
            className={
              activeTab === "registrations"
                ? "rounded-lg bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white shadow-sm"
                : "rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-400 hover:text-neutral-200"
            }
          >
            Registrations
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("purchases")}
            className={
              activeTab === "purchases"
                ? "rounded-lg bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white shadow-sm"
                : "rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-400 hover:text-neutral-200"
            }
          >
            Purchases
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={inputSearch}
              onChange={(e) => setInputSearch(e.target.value)}
              placeholder="Search by user, order, email…"
              className="h-8 rounded-lg border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-200 outline-none placeholder:text-neutral-500"
            />
            <button
              type="submit"
              className="h-8 rounded-lg bg-neutral-800 px-3 text-xs font-medium text-neutral-100 hover:bg-neutral-700"
            >
              Search
            </button>
          </form>
          <div className="flex items-center gap-1 text-xs text-neutral-400">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              className="h-8 rounded-md border border-neutral-700 bg-neutral-900 px-1 text-xs text-neutral-100"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 shadow">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-6 text-center text-sm text-neutral-400">Загрузка…</div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-red-400">{error}</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-center text-sm text-neutral-400">{emptyText}</div>
          ) : (
            <table className="min-w-full text-left text-xs text-neutral-200">
              <thead className="border-b border-neutral-800 bg-neutral-950/80 text-[11px] uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="w-9 px-2 py-2" aria-label="Expand" />
                  <th className="px-3 py-2">Event time</th>
                  {!isRegistrations && <th className="px-3 py-2">External event ID</th>}
                  <th className="px-3 py-2">User external ID</th>
                  {!isRegistrations && (
                    <>
                      <th className="px-3 py-2">Value</th>
                      <th className="px-3 py-2">Currency</th>
                    </>
                  )}
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Created at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {rows.map((r) => {
                  const isExpanded = expandedId === r.id;
                  const colCount = isRegistrations ? 7 : 10;
                  return (
                    <React.Fragment key={r.id}>
                      <tr
                        className="hover:bg-neutral-800/40"
                        onClick={() => setExpandedId((id) => (id === r.id ? null : r.id))}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setExpandedId((id) => (id === r.id ? null : r.id));
                          }
                        }}
                        aria-expanded={isExpanded}
                      >
                        <td className="w-9 px-2 py-2 align-middle">
                          <span
                            className={`inline-block transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            aria-hidden
                          >
                            ▶
                          </span>
                        </td>
                        <td className="max-w-[140px] truncate px-3 py-2">{fmtTime(r.event_time)}</td>
                        {!isRegistrations && (
                          <td className="max-w-[140px] truncate px-3 py-2 text-neutral-300">{cell(r.external_event_id)}</td>
                        )}
                        <td className="max-w-[140px] truncate px-3 py-2 text-neutral-300">{cell(r.user_external_id)}</td>
                        {!isRegistrations && (
                          <>
                            <td className="px-3 py-2 text-neutral-300">{r.value != null ? r.value : "—"}</td>
                            <td className="max-w-[80px] truncate px-3 py-2 text-neutral-300">{cell(r.currency)}</td>
                          </>
                        )}
                        <td className="max-w-[100px] truncate px-3 py-2 text-neutral-400">{cell(r.source)}</td>
                        <td className="max-w-[140px] truncate px-3 py-2 text-neutral-300">{cell(r.email)}</td>
                        <td className="max-w-[120px] truncate px-3 py-2 text-neutral-300">{cell(r.phone)}</td>
                        <td className="max-w-[140px] truncate px-3 py-2 text-neutral-400">{fmtTime(r.created_at)}</td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-neutral-900/80">
                          <td colSpan={colCount} className="p-0 align-top">
                            <div className="border-t border-neutral-800 bg-neutral-950/60 px-4 py-3">
                              <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                                <DetailValue label="Visitor ID" value={r.visitor_id} />
                                <DetailValue label="Click ID" value={r.click_id} />
                                <DetailValue label="UTM Source" value={r.utm_source} />
                                <DetailValue label="UTM Medium" value={r.utm_medium} />
                                <DetailValue label="UTM Campaign" value={r.utm_campaign} />
                                <DetailValue label="UTM Content" value={r.utm_content} />
                                <DetailValue label="UTM Term" value={r.utm_term} />
                                {!isRegistrations && <DetailValue label="External event ID" value={r.external_event_id} />}
                                <div className="grid grid-cols-[minmax(0,120px)_1fr] gap-x-3 gap-y-0.5 sm:col-span-2 lg:col-span-3 sm:grid-cols-[minmax(0,140px)_1fr]">
                                  <span className="text-neutral-500">Metadata:</span>
                                  <div className="min-w-0">
                                    {r.metadata && Object.keys(r.metadata).length > 0 ? (
                                      <pre className="max-h-40 overflow-x-auto overflow-y-auto rounded border border-neutral-700 bg-neutral-900 p-2 font-mono text-[11px] text-neutral-300">
                                        {JSON.stringify(r.metadata, null, 2)}
                                      </pre>
                                    ) : (
                                      <span className="font-mono text-[11px] text-neutral-500">—</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-3 border-t border-neutral-800 px-4 py-2 text-xs text-neutral-400">
          <div>
            Page <span className="font-semibold text-neutral-100">{page}</span> of{" "}
            <span className="font-semibold text-neutral-100">{totalPages}</span>{" "}
            {total > 0 && (
              <span className="ml-2">
                · Total <span className="font-semibold text-neutral-100">{total}</span> events
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-neutral-700 px-2 py-1 text-xs disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded border border-neutral-700 px-2 py-1 text-xs disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

