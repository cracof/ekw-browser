import React, { useState, useEffect } from "react";
import { Search, Play, Database, FileText, AlertCircle, CheckCircle2, Loader2, ChevronRight, History } from "lucide-react";
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

export default function App() {
  const [registers, setRegisters] = useState<Register[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchPrefix, setSearchPrefix] = useState("KR1P");
  const [searchNumber, setSearchNumber] = useState("");
  const [bulkStart, setBulkStart] = useState("00000001");
  const [bulkCount, setBulkCount] = useState(10);
  const [selectedRegister, setSelectedRegister] = useState<Register | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRegisters = async () => {
    try {
      const res = await fetch("/api/registers");
      const data = await res.json();
      setRegisters(data);
    } catch (err) {
      console.error("Failed to fetch registers", err);
    }
  };

  useEffect(() => {
    fetchRegisters();
    const interval = setInterval(fetchRegisters, 10000);
    return () => clearInterval(interval);
  }, []);

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
      fetchRegisters();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkStart = async () => {
    try {
      await fetch("/api/bulk-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: searchPrefix, startNumber: bulkStart, count: bulkCount }),
      });
      alert("Bulk scraping started in background");
    } catch (err) {
      console.error("Failed to start bulk scrape", err);
    }
  };

  return (
    <div className="min-h-screen bg-bg-main text-text-main font-sans selection:bg-primary selection:text-white">
      {/* Header */}
      <header className="bg-primary text-white px-6 h-16 flex justify-between items-center border-b-4 border-primary-light shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded flex items-center justify-center">
            <div className="w-5 h-5 border-4 border-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight uppercase">KW-CONTROLLER v1.0</h1>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-4 text-[11px] font-mono uppercase tracking-wider">
          <span className="bg-white/10 px-3 py-1 rounded border border-white/20">
            HOST: <strong className="text-primary-light">PROXMOX-LXC</strong>
          </span>
          <span className="bg-white/10 px-3 py-1 rounded border border-white/20">
            ENGINE: <strong className="text-primary-light">NODEJS/PUPPETEER</strong>
          </span>
          <div className="flex items-center gap-2 px-3 py-1 bg-white/10 rounded border border-white/20">
            <div className="w-2 h-2 rounded-full bg-success-theme animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            SYSTEM ONLINE
          </div>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-5 p-5 max-w-[1400px] mx-auto">
        {/* Sidebar / Controls */}
        <aside className="lg:col-span-3 space-y-5">
          {/* Single Search Card */}
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
                    onChange={(e) => setSearchPrefix(e.target.value)}
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
                disabled={loading}
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

          {/* Bulk Scraper Card */}
          <div className="bg-bg-card border border-border-theme rounded-lg shadow-sm p-5">
            <div className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4 flex items-center gap-2">
              <Database size={14} />
              Zadanie Sekwencyjne
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
                  onChange={(e) => setBulkCount(parseInt(e.target.value))}
                  className="w-full bg-white border border-border-theme p-2.5 text-sm font-mono rounded focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                />
              </div>
              <button
                onClick={handleBulkStart}
                className="w-full border-2 border-primary text-primary py-2.5 text-sm font-bold uppercase rounded hover:bg-primary hover:text-white transition-all flex items-center justify-center gap-2"
              >
                <Play size={16} />
                Uruchom Kolejkę
              </button>
            </div>
          </div>

          {/* Stats Card */}
          <div className="bg-bg-card border border-border-theme rounded-lg shadow-sm p-5">
            <div className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4">
              Statystyki Lokalne (SQLite)
            </div>
            <div className="space-y-2 text-sm font-mono">
              <div className="flex justify-between border-b border-border-theme pb-2">
                <span className="text-text-muted">Pobrane:</span>
                <span className="font-bold">{registers.length}</span>
              </div>
              <div className="flex justify-between border-b border-border-theme pb-2">
                <span className="text-text-muted">Sukcesy:</span>
                <span className="font-bold text-success-theme">{registers.filter(r => r.status === 'success').length}</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="lg:col-span-9 flex flex-col gap-5">
          {/* Terminal View (Simulated) */}
          <div className="bg-[#1e1e1e] text-[#dcdcdc] font-mono p-5 rounded-lg shadow-inner min-h-[200px] text-[13px] leading-relaxed border border-white/5">
            <div className="text-blue-400">[SYSTEM] Gotowość do pracy. Oczekiwanie na zapytanie...</div>
            {loading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-1"
              >
                <div className="text-blue-400">[FETCH] Nawiązywanie połączenia z serwerem EKW...</div>
                <div className="text-green-400">[OK] Połączono. Przesyłanie zapytania dla {searchPrefix}/{searchNumber}...</div>
                <div className="text-blue-400">[PARSER] Wykryto strukturę strony. Rozpoczynam mapowanie pól...</div>
              </motion.div>
            )}
            <div className="mt-2 opacity-50">_</div>
          </div>

          {/* Records Table Card */}
          <div className="bg-bg-card border border-border-theme rounded-lg shadow-sm flex flex-col overflow-hidden flex-1">
            <div className="p-5 border-b border-border-theme bg-bg-main/50">
              <div className="text-xs font-bold text-text-muted uppercase tracking-widest">
                Ostatnio Pobrane Rekordy
              </div>
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
                        className={`group cursor-pointer hover:bg-primary/5 transition-colors ${selectedRegister?.id === reg.id ? 'bg-primary/5' : ''}`}
                      >
                        <td className="px-6 py-4 border-b border-border-theme font-mono text-xs text-text-muted">{reg.id}</td>
                        <td className="px-6 py-4 border-b border-border-theme font-bold font-mono text-primary">{reg.full_number}</td>
                        <td className="px-6 py-4 border-b border-border-theme text-center">
                          {reg.status === 'success' ? (
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
              {registers.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 opacity-20">
                  <History size={48} strokeWidth={1} />
                  <p className="font-mono text-sm mt-4 uppercase tracking-widest">Baza danych jest pusta</p>
                </div>
              )}
            </div>
          </div>

          {/* Detail View (Slide-over) */}
          <AnimatePresence>
            {selectedRegister && (
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed inset-y-0 right-0 w-full lg:w-[600px] bg-bg-card border-l-4 border-primary shadow-2xl z-50 flex flex-col"
              >
                <div className="p-6 bg-primary text-white flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold font-mono tracking-tight">{selectedRegister.full_number}</h2>
                    <p className="text-[10px] font-bold opacity-70 uppercase tracking-widest mt-1">Pełny Raport Systemowy</p>
                  </div>
                  <button
                    onClick={() => setSelectedRegister(null)}
                    className="p-2 hover:bg-white/20 rounded-full transition-colors"
                  >
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
