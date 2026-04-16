import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Copy,
  Database,
  ExternalLink,
  FileText,
  History,
  Loader2,
  Play,
  RefreshCcw,
  Search,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Register {
  id: number;
  prefix: string;
  number: string;
  check_digit: number;
  full_number: string;
  status: string;
  last_updated: string;
  parsed_data: string;
}

interface QueueItem {
  id: number;
  prefix: string;
  number: string;
  check_digit: number;
  full_number: string;
  status: "pending" | "in_progress" | "success" | "error";
  source: string;
  last_error: string | null;
  updated_at: string;
}

interface QueuePayload {
  stats: {
    total: number;
    pending: number;
    in_progress: number;
    success: number;
    error: number;
  };
  items: QueueItem[];
  next: QueueItem | null;
  bookmarklet: string;
}

export default function App() {
  const [registers, setRegisters] = useState<Register[]>([]);
  const [queue, setQueue] = useState<QueuePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [searchPrefix, setSearchPrefix] = useState("KR1P");
  const [searchNumber, setSearchNumber] = useState("");
  const [bulkStart, setBulkStart] = useState("00000001");
  const [bulkCount, setBulkCount] = useState(10);
  const [selectedRegister, setSelectedRegister] = useState<Register | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const currentItem =
    queue?.items.find((item) => item.status === "in_progress") ??
    queue?.next ??
    null;

  const fetchRegisters = async () => {
    try {
      const res = await fetch("/api/registers");
      const data = await res.json();
      setRegisters(data);
    } catch (err) {
      console.error("Failed to fetch registers", err);
    }
  };

  const fetchQueue = async () => {
    try {
      const res = await fetch("/api/batch-queue");
      const data = await res.json();
      setQueue(data);
    } catch (err) {
      console.error("Failed to fetch queue", err);
    }
  };

  useEffect(() => {
    fetchRegisters();
    fetchQueue();
    const interval = setInterval(() => {
      fetchRegisters();
      fetchQueue();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const formatErrorMessage = (message: string) => {
    if (message.includes("antybot") || message.includes("ochronną")) {
      return `${message} W tym workflow przejdź na stronę wyniku ręcznie i użyj bookmarkletu do importu.`;
    }
    if (message.includes("nie istnieje w kolejce")) {
      return `${message} Najpierw dodaj numer do zakresu, a potem importuj stronę.`;
    }
    return message;
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: searchPrefix, number: searchNumber }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await Promise.all([fetchRegisters(), fetchQueue()]);
    } catch (err: any) {
      setError(formatErrorMessage(err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleQueueCreate = async () => {
    setQueueLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/batch-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix: searchPrefix,
          startNumber: bulkStart,
          count: bulkCount,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await fetchQueue();
    } catch (err: any) {
      setError(formatErrorMessage(err.message));
    } finally {
      setQueueLoading(false);
    }
  };

  const handleNextItem = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/batch-next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await fetchQueue();
    } catch (err: any) {
      setError(formatErrorMessage(err.message));
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetItem = async (fullNumber: string) => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/batch-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullNumber }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await fetchQueue();
    } catch (err: any) {
      setError(formatErrorMessage(err.message));
    } finally {
      setActionLoading(false);
    }
  };

  const copyBookmarklet = async () => {
    if (!queue?.bookmarklet) return;
    await navigator.clipboard.writeText(queue.bookmarklet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const getStatusBadge = (status: QueueItem["status"]) => {
    switch (status) {
      case "success":
        return "bg-green-100 text-green-700";
      case "in_progress":
        return "bg-amber-100 text-amber-700";
      case "error":
        return "bg-red-100 text-red-700";
      default:
        return "bg-blue-100 text-blue-700";
    }
  };

  return (
    <div className="min-h-screen bg-bg-main text-text-main font-sans selection:bg-primary selection:text-white">
      <header className="bg-primary text-white px-6 h-16 flex justify-between items-center border-b-4 border-primary-light shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded flex items-center justify-center">
            <div className="w-5 h-5 border-4 border-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight uppercase">KW-CONTROLLER v2.0</h1>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-4 text-[11px] font-mono uppercase tracking-wider">
          <span className="bg-white/10 px-3 py-1 rounded border border-white/20">TRYB: OPERATOR</span>
          <span className="bg-white/10 px-3 py-1 rounded border border-white/20">KOLEJKA: ZAKRES KW</span>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-5 p-5 max-w-[1500px] mx-auto">
        <aside className="lg:col-span-4 space-y-5">
          <div className="bg-bg-card border border-border-theme rounded-lg shadow-sm p-5">
            <div className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4 flex items-center gap-2">
              <Search size={14} />
              Wyszukiwanie Pojedyncze
            </div>
            <form onSubmit={handleSearch} className="space-y-4">
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-text-main uppercase">Prefiks Sądu</label>
                  <input
                    type="text"
                    value={searchPrefix}
                    onChange={(e) => setSearchPrefix(e.target.value.toUpperCase())}
                    placeholder="np. KR1P"
                    className="w-full bg-white border border-border-theme p-2.5 text-sm font-mono rounded focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-text-main uppercase">Numer Księgi (8 cyfr)</label>
                  <input
                    type="text"
                    value={searchNumber}
                    onChange={(e) => setSearchNumber(e.target.value)}
                    placeholder="00000000"
                    className="w-full bg-white border border-border-theme p-2.5 text-sm font-mono rounded focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  />
                </div>
              </div>
              <button
                disabled={loading || actionLoading || queueLoading}
                className="w-full bg-primary text-white py-2.5 text-sm font-bold uppercase rounded shadow-sm hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
                Pobierz i Parsuj
              </button>
            </form>
            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-600 text-[11px] font-mono rounded flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                {error}
              </div>
            )}
          </div>

          <div className="bg-bg-card border border-border-theme rounded-lg shadow-sm p-5">
            <div className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4 flex items-center gap-2">
              <Database size={14} />
              Kolejka Zakresu
            </div>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-text-main uppercase">Indeks Startowy</label>
                <input
                  type="text"
                  value={bulkStart}
                  onChange={(e) => setBulkStart(e.target.value)}
                  className="w-full bg-white border border-border-theme p-2.5 text-sm font-mono rounded focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-text-main uppercase">Ilość Rekordów</label>
                <input
                  type="number"
                  value={bulkCount}
                  onChange={(e) => setBulkCount(parseInt(e.target.value || "0", 10))}
                  className="w-full bg-white border border-border-theme p-2.5 text-sm font-mono rounded focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleQueueCreate}
                  disabled={queueLoading || actionLoading}
                  className="w-full border-2 border-primary text-primary py-2.5 text-sm font-bold uppercase rounded hover:bg-primary hover:text-white disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {queueLoading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                  Dodaj Zakres
                </button>
                <button
                  onClick={handleNextItem}
                  disabled={actionLoading || queueLoading}
                  className="w-full bg-slate-900 text-white py-2.5 text-sm font-bold uppercase rounded disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {actionLoading ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />}
                  Następny
                </button>
              </div>
            </div>
          </div>

          <div className="bg-bg-card border border-border-theme rounded-lg shadow-sm p-5">
            <div className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4 flex items-center gap-2">
              <FileText size={14} />
              Import Jednym Kliknięciem
            </div>
            <div className="space-y-3 text-sm">
              <p className="text-text-muted leading-relaxed">
                Skopiuj bookmarklet, dodaj go do zakładek przeglądarki i klikaj na stronie wyniku eKW. Aplikacja sama
                zaczyta HTML i zapisze rekord do kolejki.
              </p>
              <button
                onClick={copyBookmarklet}
                className="w-full border border-border-theme py-2.5 rounded text-sm font-bold uppercase flex items-center justify-center gap-2 hover:bg-bg-main/40 transition-colors"
              >
                <Copy size={16} />
                {copied ? "Skopiowano Bookmarklet" : "Kopiuj Bookmarklet"}
              </button>
              <div className="text-[11px] font-mono break-all p-3 bg-slate-100 rounded border border-border-theme text-slate-700 max-h-32 overflow-auto">
                {queue?.bookmarklet || "Ładowanie bookmarkletu..."}
              </div>
            </div>
          </div>

          <div className="bg-bg-card border border-border-theme rounded-lg shadow-sm p-5">
            <div className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4">
              Statystyki Kolejki
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm font-mono">
              <div className="border border-border-theme rounded p-3">
                <div className="text-text-muted text-[11px] uppercase">Łącznie</div>
                <div className="text-2xl font-bold">{queue?.stats.total ?? 0}</div>
              </div>
              <div className="border border-border-theme rounded p-3">
                <div className="text-text-muted text-[11px] uppercase">Gotowe</div>
                <div className="text-2xl font-bold text-green-700">{queue?.stats.success ?? 0}</div>
              </div>
              <div className="border border-border-theme rounded p-3">
                <div className="text-text-muted text-[11px] uppercase">Oczekujące</div>
                <div className="text-2xl font-bold text-blue-700">{queue?.stats.pending ?? 0}</div>
              </div>
              <div className="border border-border-theme rounded p-3">
                <div className="text-text-muted text-[11px] uppercase">Błędy</div>
                <div className="text-2xl font-bold text-red-700">{queue?.stats.error ?? 0}</div>
              </div>
            </div>
          </div>
        </aside>

        <div className="lg:col-span-8 flex flex-col gap-5">
          <div className="bg-[#1e1e1e] text-[#dcdcdc] font-mono p-5 rounded-lg shadow-inner min-h-[200px] text-[13px] leading-relaxed border border-white/5">
            <div className="text-blue-400">[SYSTEM] Workflow operatora aktywny.</div>
            <div className="text-blue-400">[QUEUE] Zakres numerów jest śledzony w SQLite i można go wznawiać.</div>
            {currentItem ? (
              <div className="mt-4 space-y-2">
                <div className="text-green-400">[CURRENT] {currentItem.full_number}</div>
                <div className="text-slate-300">
                  Otwórz wynik dla tego numeru w eKW, a następnie kliknij bookmarklet w przeglądarce.
                </div>
                <div className="flex flex-wrap gap-3 mt-3">
                  <a
                    href="https://przegladarka-ekw.ms.gov.pl/eukw_prz/KsiegiWieczyste/wyszukiwanieKW"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-2 bg-white/10 rounded border border-white/20 hover:bg-white/15"
                  >
                    <ExternalLink size={14} />
                    Otwórz eKW
                  </a>
                  <button
                    onClick={() => handleResetItem(currentItem.full_number)}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-white/10 rounded border border-white/20 hover:bg-white/15"
                  >
                    <RefreshCcw size={14} />
                    Resetuj Bieżący
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-slate-300">[QUEUE] Brak aktywnego elementu. Dodaj zakres i kliknij „Następny”.</div>
            )}
            <div className="mt-2 opacity-50">_</div>
          </div>

          <div className="bg-bg-card border border-border-theme rounded-lg shadow-sm overflow-hidden">
            <div className="p-5 border-b border-border-theme bg-bg-main/50 flex items-center justify-between">
              <div className="text-xs font-bold text-text-muted uppercase tracking-widest">Kolejka Operacyjna</div>
              <button
                onClick={fetchQueue}
                className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2"
              >
                <RefreshCcw size={14} />
                Odśwież
              </button>
            </div>
            <div className="overflow-x-auto max-h-[360px]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-bg-main/30 text-[11px] font-bold text-text-muted uppercase tracking-wider">
                    <th className="px-4 py-3 border-b-2 border-border-theme">Numer</th>
                    <th className="px-4 py-3 border-b-2 border-border-theme">Status</th>
                    <th className="px-4 py-3 border-b-2 border-border-theme">Błąd</th>
                    <th className="px-4 py-3 border-b-2 border-border-theme"></th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {(queue?.items ?? []).slice(0, 50).map((item) => (
                    <tr key={item.id} className="hover:bg-primary/5 transition-colors">
                      <td className="px-4 py-3 border-b border-border-theme font-mono font-bold text-primary">{item.full_number}</td>
                      <td className="px-4 py-3 border-b border-border-theme">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase ${getStatusBadge(item.status)}`}>
                          {item.status === "success" ? <CheckCircle2 size={12} /> : item.status === "in_progress" ? <Loader2 size={12} className="animate-spin" /> : <History size={12} />}
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 border-b border-border-theme text-xs text-text-muted max-w-[260px] truncate">
                        {item.last_error || "—"}
                      </td>
                      <td className="px-4 py-3 border-b border-border-theme text-right">
                        {(item.status === "error" || item.status === "in_progress") && (
                          <button
                            onClick={() => handleResetItem(item.full_number)}
                            className="text-xs font-bold uppercase text-primary"
                          >
                            Reset
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(queue?.items.length ?? 0) === 0 && (
                <div className="flex flex-col items-center justify-center py-20 opacity-20">
                  <History size={48} strokeWidth={1} />
                  <p className="font-mono text-sm mt-4 uppercase tracking-widest">Kolejka jest pusta</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-bg-card border border-border-theme rounded-lg shadow-sm flex flex-col overflow-hidden flex-1">
            <div className="p-5 border-b border-border-theme bg-bg-main/50">
              <div className="text-xs font-bold text-text-muted uppercase tracking-widest">Ostatnio Zapisane Rekordy</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-bg-main/30 text-[11px] font-bold text-text-muted uppercase tracking-wider">
                    <th className="px-6 py-4 border-b-2 border-border-theme">ID</th>
                    <th className="px-6 py-4 border-b-2 border-border-theme">Numer Księgi</th>
                    <th className="px-6 py-4 border-b-2 border-border-theme text-center">Status</th>
                    <th className="px-6 py-4 border-b-2 border-border-theme">Data Aktualizacji</th>
                    <th className="px-6 py-4 border-b-2 border-border-theme"></th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <AnimatePresence mode="popLayout">
                    {registers.map((reg) => (
                      <motion.tr
                        key={reg.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setSelectedRegister(reg)}
                        className={`group cursor-pointer hover:bg-primary/5 transition-colors ${selectedRegister?.id === reg.id ? "bg-primary/5" : ""}`}
                      >
                        <td className="px-6 py-4 border-b border-border-theme font-mono text-xs text-text-muted">{reg.id}</td>
                        <td className="px-6 py-4 border-b border-border-theme font-bold font-mono text-primary">{reg.full_number}</td>
                        <td className="px-6 py-4 border-b border-border-theme text-center">
                          {reg.status === "success" ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-green-100 text-green-700 text-[10px] font-bold uppercase">
                              <CheckCircle2 size={12} /> Zapisano
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-blue-100 text-blue-700 text-[10px] font-bold uppercase">
                              <Loader2 size={12} className="animate-spin" /> Przetwarzanie
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 border-b border-border-theme font-mono text-xs text-text-muted">
                          {new Date(reg.last_updated).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 border-b border-border-theme text-right">
                          <ChevronRight size={16} className="inline opacity-0 group-hover:opacity-100 text-primary transition-opacity" />
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </div>

          <AnimatePresence>
            {selectedRegister && (
              <motion.div
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="fixed inset-y-0 right-0 w-full lg:w-[600px] bg-bg-card border-l-4 border-primary shadow-2xl z-50 flex flex-col"
              >
                <div className="p-6 bg-primary text-white flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold font-mono tracking-tight">{selectedRegister.full_number}</h2>
                    <p className="text-[10px] font-bold opacity-70 uppercase tracking-widest mt-1">Pełny Raport Systemowy</p>
                  </div>
                  <button onClick={() => setSelectedRegister(null)} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                    <ChevronRight size={24} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-8 space-y-10">
                  {selectedRegister.parsed_data ? (
                    Object.entries(JSON.parse(selectedRegister.parsed_data)).map(([section, data]: [string, any]) => (
                      <div key={section} className="space-y-5">
                        <h3 className="text-sm font-bold text-primary uppercase tracking-widest border-b-2 border-border-theme pb-2 flex items-center gap-2">
                          <FileText size={16} />
                          {section}
                        </h3>
                        <div className="space-y-1">
                          {Object.entries(data).map(([label, value]: [string, any]) => (
                            <div key={label} className="grid grid-cols-3 gap-6 py-3 border-b border-border-theme/50 hover:bg-bg-main/30 px-2 transition-colors rounded">
                              <div className="col-span-1 text-[10px] font-bold text-text-muted uppercase leading-tight">{label}</div>
                              <div className="col-span-2 text-sm font-mono text-text-main break-words">{value}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-20 opacity-30">
                      <AlertCircle size={48} strokeWidth={1} />
                      <p className="font-mono text-sm mt-4 uppercase tracking-widest">Brak danych strukturalnych</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
