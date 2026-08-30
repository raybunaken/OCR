"use client";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function Home() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [deleteModalData, setDeleteModalData] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [highlightedWord, setHighlightedWord] = useState("");
  const [isEditMode, setIsEditMode] = useState(false);

  const highlightInSource = (textToFind: string) => {
    if (!textToFind || textToFind === "-") {
      setHighlightedWord("");
      return;
    }
    setHighlightedWord(textToFind);
  };

  const renderHighlightedText = (text: string, highlight: string) => {
    if (!highlight || highlight === "-" || highlight.trim().length < 2) return text;
    
    // ATTEMPT 1: EXACT PHRASE MATCH (ignoring spaces/newlines)
    const exactSafe = highlight
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '[\\s\\n]+');
      
    try {
      const exactRegex = new RegExp(`(${exactSafe})`, 'gi');
      if (exactRegex.test(text)) {
        const parts = text.split(exactRegex);
        return (
          <>
            {parts.map((part, i) => 
              i % 2 === 1 
                ? <mark key={i} className="bg-yellow-400 text-slate-900 px-1 rounded font-bold shadow-lg shadow-yellow-500/20 animate-pulse">{part}</mark> 
                : part
            )}
          </>
        );
      }
    } catch (e) {
      // Continue to fallback
    }

    // ATTEMPT 2: FUZZY WORD MATCH (if exact phrase isn't found because AI modified it slightly)
    const stopWords = ['yang', 'dari', 'pada', 'atau', 'untuk', 'dengan', 'bahwa', 'kami', 'maka', 'dan', 'ini', 'itu', 'sebagai', 'atas', 'hari', 'tanggal', 'bulan', 'tahun', 'kepada', 'dalam', 'hal', 'rp', 'no'];
    
    const words = highlight
      .split(/\s+/)
      .map(w => w.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')) // Strip leading/trailing punctuation from each word
      .filter(w => w.length > 2 && !stopWords.includes(w.toLowerCase()));
      
    if (words.length === 0) return text;
    
    const safeWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    
    try {
      // Sort so longer words are processed/matched first just in case
      safeWords.sort((a, b) => b.length - a.length);
      const fuzzyRegex = new RegExp(`(${safeWords.join('|')})`, 'gi');
      const parts = text.split(fuzzyRegex);
      
      return (
        <>
          {parts.map((part, i) => 
            i % 2 === 1 
              ? <mark key={i} className="bg-yellow-300 text-slate-900 px-1 rounded shadow-sm">{part}</mark> 
              : part
          )}
        </>
      );
    } catch (e) {
      return text;
    }
  };

  // Helper to parse numeric values from currency string (e.g. "Rp. 1.373.689.860,00" -> 1373689860)
  const parseNumericValue = (valStr: string) => {
    if (!valStr || valStr === "-") return 0;
    const cleaned = valStr.replace(/\./g, "").replace(/,/g, ".");
    const num = parseFloat(cleaned.replace(/[^0-9.]/g, ""));
    return isNaN(num) ? 0 : num;
  };

  // States untuk Pencarian Ultimate & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("Semua");
  const [filterMonth, setFilterMonth] = useState("Semua");
  const [sortBy, setSortBy] = useState("Terbaru");

  const resetFilters = () => {
    setSearchQuery("");
    setFilterType("Semua");
    setFilterMonth("Semua");
    setSortBy("Terbaru");
  };

  const isFiltered = searchQuery !== "" || filterType !== "Semua" || filterMonth !== "Semua" || sortBy !== "Terbaru";

  // Filter & Sort Otomatis (Real-time)
  const filteredDocuments = documents.filter((doc) => {
    const query = searchQuery.toLowerCase().trim();
    const matchesSearch = !query ? true : (
      (doc.nama_klien?.toLowerCase() || "").includes(query) || 
      (doc.nilai_proyek?.toLowerCase() || "").includes(query) ||
      (doc.nomor_identitas?.toLowerCase() || "").includes(query) ||
      (doc.obligee?.toLowerCase() || "").includes(query) ||
      (doc.pekerjaan?.toLowerCase() || "").includes(query)
    );
    const matchesType = filterType === "Semua" ? true : doc.jenis_dokumen?.toLowerCase().includes(filterType.toLowerCase());
    
    // Asumsi doc.created_at formatnya "YYYY-MM-DD HH:MM:SS"
    const docMonth = doc.created_at ? doc.created_at.substring(5, 7) : "";
    const matchesMonth = filterMonth === "Semua" ? true : docMonth === filterMonth;
    
    return matchesSearch && matchesType && matchesMonth;
  }).sort((a, b) => {
    if (sortBy === "Terbaru") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (sortBy === "Terlama") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (sortBy === "Nilai Tertinggi") return parseNumericValue(b.nilai_proyek) - parseNumericValue(a.nilai_proyek);
    if (sortBy === "Nilai Terendah") return parseNumericValue(a.nilai_proyek) - parseNumericValue(b.nilai_proyek);
    if (sortBy === "Nama (A-Z)") return (a.nama_klien || "").localeCompare(b.nama_klien || "");
    if (sortBy === "Nama (Z-A)") return (b.nama_klien || "").localeCompare(a.nama_klien || "");
    return 0;
  });



  // Fetch Documents
  const fetchDocuments = async () => {
    try {
      const res = await fetch(`${API_URL}/api/documents`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setDocuments(data);
      } else {
        console.error("Backend error or non-array returned:", data);
        setDocuments([]);
      }
    } catch (err) {
      console.error("Fetch error:", err);
      setDocuments([]);
    }
  };

  useEffect(() => {
    if (activeTab === "dashboard") {
      fetchDocuments();
    }
  }, [activeTab]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API_URL}/api/extract`, {
        method: "POST",
        body: formData,
      });
      const result = await res.json();
      if (res.ok && result.status === "success") {
        setExtractedData(result.data); // data hasil extract belum ada ID
        toast.success("Dokumen berhasil diproses oleh AI!");
      } else {
        toast.error(`Gagal: ${result.detail || "Tidak dapat memproses dokumen."}`);
      }
    } catch (err: any) {
      toast.error(`Terjadi kesalahan jaringan: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = async () => {
    if (!extractedData) return;
    
    const payload = {
      nama_klien: extractedData.principal || "-",
      jenis_dokumen: extractedData.jenis_jaminan || "-",
      nomor_identitas: extractedData.nomor_jaminan || "-",
      nilai_proyek: extractedData.nilai_jaminan || "-",
      obligee: extractedData.obligee || "-",
      pekerjaan: extractedData.pekerjaan || "-",
      masa_berlaku: extractedData.masa_berlaku || "-",
      teks_dokumen: extractedData.teks_asli || "-"
    };

    try {
      if (extractedData.id) {
        // Mode Edit (Update data yang sudah ada)
        await fetch(`${API_URL}/api/documents/${extractedData.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast.success("Dokumen berhasil diperbarui!");
      } else {
        // Mode Simpan Baru
        await fetch(`${API_URL}/api/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast.success("Data berhasil disimpan secara permanen!");
      }
      
      setExtractedData(null);
      setFile(null);
      setActiveTab("dashboard");
    } catch (err) {
      toast.error("Gagal menyimpan ke database.");
    }
  };

  const confirmDeleteDocument = async () => {
    if (!deleteModalData || isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`${API_URL}/api/documents/${deleteModalData.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Dokumen berhasil dihapus selamanya!");
        await fetchDocuments();
      } else {
        toast.error("Gagal menghapus dokumen");
      }
    } catch (e) {
      toast.error("Kesalahan jaringan atau server sedang memuat");
    } finally {
      setIsDeleting(false);
      setDeleteModalData(null);
    }
  };

  const calculateDays = (dateStr: string) => {
    if (!dateStr || dateStr === "-") return null;

    // 1. Prioritas 1: Jika ada angka eksplisit hari e.g. "120 HK", "120 HKal", "120 Hari", "120 (Seratus Dua Puluh) hari"
    const explicitMatch = dateStr.match(/(\d+)\s*(?:\([^)]*\)\s*)?(?:hari|days?|hk\b|hkal\b|h\.k)/i);
    if (explicitMatch) {
      return parseInt(explicitMatch[1], 10);
    }

    // 2. Kamus bulan lengkap (termasuk ejaan lokal Indonesia seperti Nopember, Pebruari, Agust, dll)
    const months: Record<string, number> = {
      "januari": 0, "jan": 0, "january": 0,
      "februari": 1, "pebruari": 1, "feb": 1, "peb": 1, "february": 1,
      "maret": 2, "mar": 2, "march": 2,
      "april": 3, "apr": 3,
      "mei": 4, "may": 4,
      "juni": 5, "jun": 5, "june": 5,
      "juli": 6, "jul": 6, "july": 6,
      "agustus": 7, "agu": 7, "agt": 7, "agus": 7, "agust": 7, "aug": 7, "august": 7,
      "september": 8, "sep": 8, "sept": 8,
      "oktober": 9, "okt": 9, "oct": 9, "october": 9,
      "november": 10, "nopember": 10, "nov": 10, "nop": 10,
      "desember": 11, "des": 11, "dec": 11, "december": 11
    };

    // Format tanggal teks e.g. "3 AGUSTUS 2026 S/D 30 NOPEMBER 2026"
    const textDateRegex = /(\d{1,2})\s*([a-zA-Z]+)\s*(\d{4})/g;
    const matches = [...dateStr.matchAll(textDateRegex)];
    if (matches.length >= 2) {
      const d1 = parseInt(matches[0][1], 10), y1 = parseInt(matches[0][3], 10);
      const m1 = months[matches[0][2].toLowerCase()];
      const d2 = parseInt(matches[1][1], 10), y2 = parseInt(matches[1][3], 10);
      const m2 = months[matches[1][2].toLowerCase()];
      if (m1 !== undefined && m2 !== undefined) {
        const date1 = new Date(y1, m1, d1);
        const date2 = new Date(y2, m2, d2);
        const diffTime = Math.abs(date2.getTime() - date1.getTime());
        return Math.round(diffTime / (1000 * 60 * 60 * 24));
      }
    }

    // Format tanggal numerik e.g. "03/08/2026 - 30/11/2026" atau "03-08-2026 s/d 30-11-2026"
    const numDateRegex = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/g;
    const numMatches = [...dateStr.matchAll(numDateRegex)];
    if (numMatches.length >= 2) {
      const d1 = parseInt(numMatches[0][1], 10), m1 = parseInt(numMatches[0][2], 10) - 1, y1 = parseInt(numMatches[0][3], 10);
      const d2 = parseInt(numMatches[1][1], 10), m2 = parseInt(numMatches[1][2], 10) - 1, y2 = parseInt(numMatches[1][3], 10);
      const date1 = new Date(y1, m1, d1);
      const date2 = new Date(y2, m2, d2);
      const diffTime = Math.abs(date2.getTime() - date1.getTime());
      return Math.round(diffTime / (1000 * 60 * 60 * 24));
    }

    return null;
  };

  const fetchAuditLogs = async (docId: number) => {
    try {
      const res = await fetch(`${API_URL}/api/documents/${docId}/logs`);
      const data = await res.json();
      setAuditLogs(data || []);
      setShowAuditModal(true);
    } catch (e) {
      toast.error("Gagal mengambil riwayat audit.");
    }
  };



  return (
    <main className="min-h-screen px-4 sm:px-8 py-10 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-600 tracking-tight">
            Ekstraktor Asuransi AI
          </h1>
          <p className="text-slate-400 mt-2 text-sm sm:text-base">Sistem Manajemen Dokumen Asuransi Berbasis AI</p>
        </div>
        <div className="glass-panel rounded-full p-1.5 flex gap-2 self-start md:self-auto shadow-lg shadow-black/20">
          <button 
            onClick={() => setActiveTab("dashboard")}
            className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all cursor-pointer ${activeTab === "dashboard" ? "bg-sky-500 text-white shadow-lg shadow-sky-500/30" : "text-slate-300 hover:text-white"}`}
          >
            Dashboard
          </button>
          <button 
            onClick={() => setActiveTab("upload")}
            className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all cursor-pointer ${activeTab === "upload" ? "bg-sky-500 text-white shadow-lg shadow-sky-500/30" : "text-slate-300 hover:text-white"}`}
          >
            Upload Dokumen
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === "dashboard" ? (
        <div className="space-y-8">
          {/* Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-slate-700/60 shadow-xl">
              <h3 className="text-slate-400 text-xs sm:text-sm font-semibold uppercase tracking-wider">Total Dokumen (Berdasarkan Filter)</h3>
              <p className="text-4xl sm:text-5xl font-light text-white mt-3">{filteredDocuments.length}</p>
            </div>
            <div className="glass-panel p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-sky-950/40 via-slate-900/60 to-blue-950/40 border border-sky-500/30 shadow-xl shadow-sky-950/20">
              <h3 className="text-sky-300 text-xs sm:text-sm font-semibold uppercase tracking-wider">Total Nilai Proyek (Berdasarkan Filter)</h3>
              <p className="text-4xl sm:text-5xl font-light text-white mt-3">
                {(() => {
                  const total = filteredDocuments.reduce((sum, doc) => {
                    if (!doc.nilai_proyek || doc.nilai_proyek === "-") return sum;
                    let valStr = doc.nilai_proyek.replace(/\./g, "").replace(/,/g, ".");
                    const num = parseFloat(valStr.replace(/[^0-9.]/g, ""));
                    return isNaN(num) ? sum : sum + num;
                  }, 0);
                  
                  if (total === 0) return "Rp 0";
                  if (total >= 1_000_000_000) return `Rp ${(total / 1_000_000_000).toFixed(1)} M`;
                  if (total >= 1_000_000) return `Rp ${(total / 1_000_000).toFixed(1)} Juta`;
                  return `Rp ${total.toLocaleString("id-ID")}`;
                })()}
              </p>
            </div>
          </div>

          {/* Table */}
          <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-slate-700/60">
            {/* Top Toolbar */}
            <div className="p-6 sm:p-8 border-b border-slate-700/60 bg-slate-900/40 space-y-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                    Arsip Jaminan Asuransi
                    <span className="text-xs font-semibold px-3 py-1 rounded-full bg-sky-950/80 text-sky-400 border border-sky-800/60">
                      {filteredDocuments.length} Dokumen
                    </span>
                  </h2>
                  <p className="text-slate-400 text-xs sm:text-sm mt-1">Daftar seluruh riwayat dokumen asuransi yang tersimpan</p>
                </div>
              </div>

              {/* Filters & Search Control Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 pt-2">
                {/* Search Bar */}
                <div className="sm:col-span-2 lg:col-span-4 relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  </div>
                  <input 
                    type="text" 
                    placeholder="Cari klien, nomor, obligee, proyek..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full glass-input rounded-xl pl-10 pr-10 py-2.5 text-sm bg-slate-900/60 border border-slate-700/80 focus:border-sky-400 focus:ring-1 focus:ring-sky-400 transition-all placeholder:text-slate-500" 
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery("")}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>

                {/* Filter: Jenis Jaminan */}
                <div className="lg:col-span-3 relative">
                  <select 
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="w-full glass-input rounded-xl px-4 py-2.5 text-sm bg-slate-900 border border-slate-700/80 focus:border-sky-400 cursor-pointer text-slate-200"
                  >
                    <option value="Semua" className="bg-slate-900 text-slate-200">Semua Jenis Jaminan</option>
                    <option value="Pelaksanaan" className="bg-slate-900 text-slate-200">Jaminan Pelaksanaan</option>
                    <option value="Uang Muka" className="bg-slate-900 text-slate-200">Jaminan Uang Muka</option>
                    <option value="Penawaran" className="bg-slate-900 text-slate-200">Jaminan Penawaran</option>
                    <option value="Pemeliharaan" className="bg-slate-900 text-slate-200">Jaminan Pemeliharaan</option>
                  </select>
                </div>

                {/* Filter: Bulan */}
                <div className="lg:col-span-2 relative">
                  <select 
                    value={filterMonth}
                    onChange={(e) => setFilterMonth(e.target.value)}
                    className="w-full glass-input rounded-xl px-4 py-2.5 text-sm bg-slate-900 border border-slate-700/80 focus:border-sky-400 cursor-pointer text-slate-200"
                  >
                    <option value="Semua" className="bg-slate-900 text-slate-200">Semua Bulan</option>
                    <option value="01" className="bg-slate-900 text-slate-200">Januari</option>
                    <option value="02" className="bg-slate-900 text-slate-200">Februari</option>
                    <option value="03" className="bg-slate-900 text-slate-200">Maret</option>
                    <option value="04" className="bg-slate-900 text-slate-200">April</option>
                    <option value="05" className="bg-slate-900 text-slate-200">Mei</option>
                    <option value="06" className="bg-slate-900 text-slate-200">Juni</option>
                    <option value="07" className="bg-slate-900 text-slate-200">Juli</option>
                    <option value="08" className="bg-slate-900 text-slate-200">Agustus</option>
                    <option value="09" className="bg-slate-900 text-slate-200">September</option>
                    <option value="10" className="bg-slate-900 text-slate-200">Oktober</option>
                    <option value="11" className="bg-slate-900 text-slate-200">November</option>
                    <option value="12" className="bg-slate-900 text-slate-200">Desember</option>
                  </select>
                </div>

                {/* Sort By */}
                <div className="lg:col-span-3 relative">
                  <select 
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="w-full glass-input rounded-xl px-4 py-2.5 text-sm bg-slate-900 border border-slate-700/80 focus:border-sky-400 cursor-pointer text-slate-200"
                  >
                    <option value="Terbaru" className="bg-slate-900 text-slate-200">Urutkan: Paling Baru</option>
                    <option value="Terlama" className="bg-slate-900 text-slate-200">Urutkan: Paling Lama</option>
                    <option value="Nilai Tertinggi" className="bg-slate-900 text-slate-200">Urutkan: Nilai Tertinggi</option>
                    <option value="Nilai Terendah" className="bg-slate-900 text-slate-200">Urutkan: Nilai Terendah</option>
                    <option value="Nama (A-Z)" className="bg-slate-900 text-slate-200">Urutkan: Klien (A → Z)</option>
                    <option value="Nama (Z-A)" className="bg-slate-900 text-slate-200">Urutkan: Klien (Z → A)</option>
                  </select>
                </div>
              </div>

              {/* Active Filter Chips / Reset */}
              {isFiltered && (
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/80">
                  <span className="text-xs text-slate-400 font-medium">Filter Aktif:</span>
                  {searchQuery && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-sky-900/40 text-sky-300 border border-sky-700/50">
                      Pencarian: "{searchQuery}"
                      <button onClick={() => setSearchQuery("")} className="hover:text-white cursor-pointer">✕</button>
                    </span>
                  )}
                  {filterType !== "Semua" && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-900/40 text-indigo-300 border border-indigo-700/50">
                      Jenis: {filterType}
                      <button onClick={() => setFilterType("Semua")} className="hover:text-white cursor-pointer">✕</button>
                    </span>
                  )}
                  {filterMonth !== "Semua" && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-900/40 text-amber-300 border border-amber-700/50">
                      Bulan: {filterMonth}
                      <button onClick={() => setFilterMonth("Semua")} className="hover:text-white cursor-pointer">✕</button>
                    </span>
                  )}
                  {sortBy !== "Terbaru" && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-purple-900/40 text-purple-300 border border-purple-700/50">
                      Urutan: {sortBy}
                      <button onClick={() => setSortBy("Terbaru")} className="hover:text-white cursor-pointer">✕</button>
                    </span>
                  )}
                  <button 
                    onClick={resetFilters}
                    className="text-xs text-red-400 hover:text-red-300 underline ml-auto font-medium cursor-pointer"
                  >
                    Reset Semua Filter
                  </button>
                </div>
              )}
            </div>
            <div className="overflow-x-auto min-h-[300px]">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-800/50 text-slate-400">
                  <tr>
                    <th className="p-4 font-medium">Tanggal</th>
                    <th className="p-4 font-medium">Nama Klien</th>
                    <th className="p-4 font-medium">Jenis Jaminan</th>
                    <th className="p-4 font-medium">Nilai Proyek</th>
                    <th className="p-4 font-medium text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {filteredDocuments.length === 0 ? (
                    <tr><td colSpan={5} className="p-8 text-center text-slate-400">Pencarian tidak menemukan hasil.</td></tr>
                  ) : (
                    filteredDocuments.map((doc: any) => (
                      <tr key={doc.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="p-4 text-slate-300">{doc.created_at?.substring(0,10)}</td>
                        <td className="p-4 font-medium text-white">{doc.nama_klien}</td>
                        <td className="p-4">
                          <span className={`px-3 py-1 rounded-full text-xs border whitespace-nowrap inline-block ${
                            (() => {
                              const j = (doc.jenis_dokumen || "").toLowerCase();
                              if (j.includes("pelaksanaan")) return "bg-emerald-900/30 text-emerald-400 border-emerald-500/20";
                              if (j.includes("uang muka")) return "bg-amber-900/30 text-amber-400 border-amber-500/20";
                              if (j.includes("penawaran")) return "bg-purple-900/30 text-purple-400 border-purple-500/20";
                              if (j.includes("pemeliharaan")) return "bg-sky-900/30 text-sky-400 border-sky-500/20";
                              return "bg-slate-800 text-slate-300 border-slate-600/50";
                            })()
                          }`}>
                            {doc.jenis_dokumen}
                          </span>
                        </td>
                        <td className="p-4 text-slate-300">{doc.nilai_proyek}</td>
                        <td className="p-4 text-right flex justify-end gap-2">
                          <button 
                            onClick={() => {
                              setExtractedData({
                                id: doc.id,
                                principal: doc.nama_klien,
                                jenis_jaminan: doc.jenis_dokumen,
                                nomor_jaminan: doc.nomor_identitas,
                                nilai_jaminan: doc.nilai_proyek,
                                obligee: doc.obligee,
                                pekerjaan: doc.pekerjaan,
                                masa_berlaku: doc.masa_berlaku,
                                teks_asli: doc.teks_dokumen
                              });
                              setActiveTab("upload");
                            }}
                            className="bg-sky-900/50 hover:bg-sky-500 text-sky-300 hover:text-white px-4 py-1.5 rounded-full text-xs cursor-pointer transition-colors border border-sky-500/30"
                          >
                            Buka
                          </button>
                          <button 
                            onClick={() => setDeleteModalData(doc)}
                            className="bg-red-900/30 hover:bg-red-600 text-red-400 hover:text-white px-4 py-1.5 rounded-full text-xs cursor-pointer transition-colors border border-red-500/30"
                          >
                            Hapus
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className={extractedData ? "grid grid-cols-1 xl:grid-cols-12 gap-8 max-w-[1500px] mx-auto w-full" : "max-w-2xl mx-auto space-y-6 pt-4 pb-12"}>
          
          {/* KOLOM KIRI: Upload & Data Terstruktur */}
          <div className={extractedData ? "xl:col-span-5 space-y-8" : ""}>
            
            {/* 1. Kotak Upload */}
            <div className={`glass-panel rounded-3xl text-center border-dashed border-2 border-slate-600 hover:border-sky-500 transition-colors ${extractedData ? "p-8" : "p-10 sm:p-14"}`}>
              <div className="w-16 h-16 mx-auto bg-slate-800 rounded-full flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
              </div>
              <h2 className="text-xl font-semibold mb-2">Upload Dokumen</h2>
              <p className="text-slate-400 mb-6 text-sm">Pilih file PDF, JPG, atau PNG.</p>
              
              <input type="file" onChange={handleFileChange} className="hidden" id="file-upload" />
              <label htmlFor="file-upload" className="cursor-pointer bg-slate-800 hover:bg-slate-700 text-white px-8 py-3 rounded-full font-medium transition-colors inline-block mb-4">
                {file ? file.name : "Browse Files"}
              </label>
              
              {file && (
                <div className="mt-4">
                  <button 
                    onClick={handleUpload} 
                    disabled={isUploading}
                    className="bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white px-10 py-3 rounded-full font-semibold shadow-lg shadow-sky-500/25 transition-all w-full disabled:opacity-50"
                  >
                    {isUploading ? "Memproses AI..." : "Ekstrak Sekarang"}
                  </button>
                </div>
              )}
            </div>

            {/* 2. Kotak Form Data (Muncul setelah ekstrak) */}
            {extractedData && (
              <div className="glass-panel p-8 rounded-3xl animate-in fade-in slide-in-from-left-8 duration-500">
                <div className="flex items-center gap-3 mb-6 border-b border-slate-700/50 pb-4">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]"></div>
                  <h2 className="text-lg font-semibold text-slate-200 tracking-wide">Data Terstruktur</h2>
                </div>
                
                <div className="space-y-5 mb-8">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Principal</label>
                    <input type="text" value={extractedData.principal || ""} onFocus={() => highlightInSource(extractedData.principal)} onChange={(e) => setExtractedData({...extractedData, principal: e.target.value})} className="w-full glass-input rounded-xl px-4 py-3" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Obligee</label>
                    <input type="text" value={extractedData.obligee || ""} onFocus={() => highlightInSource(extractedData.obligee)} onChange={(e) => setExtractedData({...extractedData, obligee: e.target.value})} className="w-full glass-input rounded-xl px-4 py-3" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Jenis Jaminan</label>
                      <input type="text" value={extractedData.jenis_jaminan || ""} onFocus={() => highlightInSource(extractedData.jenis_jaminan)} onChange={(e) => setExtractedData({...extractedData, jenis_jaminan: e.target.value})} className="w-full glass-input rounded-xl px-4 py-3" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Nilai Jaminan</label>
                      <input type="text" value={extractedData.nilai_jaminan || ""} onFocus={() => highlightInSource(extractedData.nilai_jaminan)} onChange={(e) => setExtractedData({...extractedData, nilai_jaminan: e.target.value})} className="w-full glass-input rounded-xl px-4 py-3" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Masa Berlaku</label>
                    <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                      <input 
                        type="text" 
                        value={extractedData.masa_berlaku || ""} 
                        onFocus={() => highlightInSource(extractedData.masa_berlaku)} 
                        onChange={(e) => setExtractedData({...extractedData, masa_berlaku: e.target.value})} 
                        className="w-full glass-input rounded-xl px-4 py-3" 
                      />
                      {(() => {
                        const days = calculateDays(extractedData.masa_berlaku);
                        if (days !== null) {
                          return (
                            <div className="bg-sky-950/70 border border-sky-500/40 text-sky-300 font-semibold px-4 py-3 rounded-xl whitespace-nowrap flex items-center gap-2 shadow-md shadow-sky-950/50 animate-in zoom-in-95 duration-200">
                              <svg className="w-4 h-4 text-sky-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span>{days} Hari</span>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Pekerjaan</label>
                    <textarea rows={3} value={extractedData.pekerjaan || ""} onFocus={() => highlightInSource(extractedData.pekerjaan)} onChange={(e) => setExtractedData({...extractedData, pekerjaan: e.target.value})} className="w-full glass-input rounded-xl px-4 py-3 resize-none overflow-y-auto" />
                  </div>
                </div>

                <div className="flex gap-4">
                  <button onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-3 rounded-xl font-semibold shadow-lg shadow-emerald-500/25 transition-all flex-1">
                    Simpan ke Database Permanen
                  </button>
                  {extractedData.id && (
                    <button onClick={() => fetchAuditLogs(extractedData.id)} className="bg-slate-800 hover:bg-slate-700 text-sky-400 px-6 py-3 rounded-xl font-semibold border border-slate-700 transition-all flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      Riwayat Edit
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* KOLOM KANAN: Dokumen Word / Teks Asli Raksasa */}
          {extractedData && (
            <div className="xl:col-span-7">
              <div className="glass-panel rounded-3xl animate-in fade-in slide-in-from-right-8 duration-500 overflow-hidden bg-[#1e293b]/90 border-slate-600 shadow-2xl">
                <div className="bg-slate-900/80 p-5 border-b border-slate-700/80 flex justify-between items-center">
                  <h2 className="text-lg font-semibold text-slate-200 uppercase tracking-widest flex items-center gap-2">
                    <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    Dokumen Asli (OCR)
                  </h2>
                  <button 
                    onClick={() => setIsEditMode(!isEditMode)}
                    className="text-xs bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-600 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5 shadow-md shadow-sky-900/20"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                    {isEditMode ? "Mode Tampilan" : "Edit Teks"}
                  </button>
                </div>
                <div className="p-6">
                  {isEditMode ? (
                    <textarea 
                      rows={35} 
                      value={extractedData.teks_asli || ""} 
                      onChange={(e) => setExtractedData({...extractedData, teks_asli: e.target.value})} 
                      className="w-full bg-[#0f172a]/60 text-slate-100 p-8 rounded-2xl font-sans text-lg leading-loose resize-none focus:outline-none focus:bg-[#0f172a]/80 transition-colors border border-slate-700/50 shadow-inner"
                      placeholder="Teks dokumen akan muncul di sini..."
                    />
                  ) : (
                    <div className="w-full min-h-[700px] h-full bg-[#0f172a]/60 text-slate-100 p-8 rounded-2xl font-sans text-lg leading-loose whitespace-pre-wrap border border-slate-700/50 shadow-inner">
                      {renderHighlightedText(extractedData.teks_asli || "", highlightedWord)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}



      {/* Modal Konfirmasi Hapus */}
      {deleteModalData && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => !isDeleting && setDeleteModalData(null)}
        >
          <div 
            className="bg-slate-800 border border-slate-700 p-8 rounded-3xl shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 bg-red-900/30 rounded-full flex items-center justify-center mb-6">
              <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Hapus Dokumen?</h3>
            <p className="text-slate-400 text-sm mb-8 leading-relaxed">
              Apakah Anda yakin ingin menghapus data atas nama <strong className="text-white">{deleteModalData.nama_klien}</strong>? Tindakan ini bersifat permanen dan tidak dapat dibatalkan.
            </p>
            <div className="flex justify-end gap-4">
              <button 
                onClick={() => setDeleteModalData(null)} 
                disabled={isDeleting}
                className="px-6 py-2.5 rounded-full text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                Batal
              </button>
              <button 
                onClick={confirmDeleteDocument} 
                disabled={isDeleting}
                className="px-6 py-2.5 rounded-full text-sm font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors shadow-lg shadow-red-500/30 cursor-pointer disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Menghapus...
                  </>
                ) : (
                  "Ya, Hapus Permanen"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Riwayat Audit */}
      {showAuditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-800 border border-slate-700 p-8 rounded-3xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-semibold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Audit Trail (Riwayat Perubahan)
              </h3>
              <button onClick={() => setShowAuditModal(false)} className="text-slate-400 hover:text-white transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="overflow-y-auto pr-2 space-y-6 flex-1">
              {auditLogs.length === 0 ? (
                <div className="text-center text-slate-400 py-10">
                  Belum ada riwayat perubahan (edit) untuk dokumen ini.
                </div>
              ) : (
                <div className="relative border-l border-slate-700 ml-3 space-y-8">
                  {auditLogs.map((log: any, idx: number) => (
                    <div key={idx} className="relative pl-6">
                      <div className="absolute w-3 h-3 bg-sky-500 rounded-full -left-[6.5px] top-1.5 ring-4 ring-slate-800"></div>
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-sm font-bold text-sky-400">{log.created_at.split(" ")[0]}</span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-sky-900/40 text-sky-300 border border-sky-700/50 flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          {log.created_at.split(" ")[1]}
                        </span>
                      </div>
                      <div className="bg-slate-900/50 p-5 rounded-xl border border-slate-700/50">
                        {log.catatan.split(" | ").map((perubahan: string, i: number) => (
                          <p key={i} className="text-base text-slate-200 mb-2 last:mb-0 leading-relaxed">
                            <span className="w-2 h-2 bg-amber-500 rounded-full inline-block mr-3 mb-[2px]"></span>
                            {perubahan}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
