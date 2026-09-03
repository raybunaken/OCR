"use client";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface BatchFileItem {
  id: string;
  file: File;
  status: "pending" | "processing" | "done" | "error";
  data?: any;
  errorMsg?: string;
}

export default function Home() {
  const APP_ENV = "testing";
  const [activeTab, setActiveTab] = useState("dashboard");
  const [uploadMode, setUploadMode] = useState<"single" | "batch">("single");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [batchFiles, setBatchFiles] = useState<BatchFileItem[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const stopBatchRef = useRef(false);
  const [documents, setDocuments] = useState<any[]>([]);
  const [deleteModalData, setDeleteModalData] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCopiedExcel, setIsCopiedExcel] = useState(false);
  const [isCopiedText, setIsCopiedText] = useState(false);
  const [isCopiedOcr, setIsCopiedOcr] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [highlightedWord, setHighlightedWord] = useState("");
  const [isEditMode, setIsEditMode] = useState(false);
  const [showValidationDetail, setShowValidationDetail] = useState(false);

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
      const res = await fetch(`${API_URL}/api/documents?env=${APP_ENV}`);
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

  const handleBatchFilesSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const newFiles: BatchFileItem[] = Array.from(e.target.files).map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file: f,
      status: "pending"
    }));
    setBatchFiles((prev) => [...prev, ...newFiles]);
    e.target.value = "";
    toast.success(`${newFiles.length} dokumen ditambahkan ke antrian.`);
  };

  const handleRemoveBatchItem = (id: string) => {
    if (isBatchProcessing) return;
    setBatchFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearBatch = () => {
    if (isBatchProcessing) return;
    setBatchFiles([]);
  };

  const handleInspectBatchItem = (item: BatchFileItem) => {
    if (!item.data) return;
    setExtractedData(item.data);
    setUploadMode("single");
    toast.info(`Membuka hasil ekstraksi: ${item.file.name}`);
  };

  const startBatchProcessing = async () => {
    if (batchFiles.length === 0 || isBatchProcessing) return;
    setIsBatchProcessing(true);
    stopBatchRef.current = false;

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < batchFiles.length; i++) {
      if (stopBatchRef.current) {
        toast.info("Proses antrian dihentikan oleh pengguna.");
        break;
      }

      const item = batchFiles[i];
      if (item.status === "done") {
        successCount++;
        continue;
      }

      // Update item to processing
      setBatchFiles((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: "processing" } : f))
      );

      try {
        const formData = new FormData();
        formData.append("file", item.file);

        // 1. Ekstrak AI
        const res = await fetch(`${API_URL}/api/extract`, {
          method: "POST",
          body: formData,
        });
        const result = await res.json();

        if (res.ok && result.status === "success" && result.data) {
          const extracted = result.data;
          
          // 2. Auto-Simpan ke Database & Auto-Sync Google Sheets
          const payload = {
            nama_klien: extracted.principal || "-",
            jenis_dokumen: extracted.jenis_jaminan || "-",
            nomor_identitas: extracted.nomor_jaminan || "-",
            nilai_proyek: extracted.nilai_jaminan || "-",
            obligee: extracted.obligee || "-",
            pekerjaan: extracted.pekerjaan || "-",
            masa_berlaku: extracted.masa_berlaku || (extracted.tgl_awal && extracted.tgl_akhir ? `${extracted.tgl_awal} s/d ${extracted.tgl_akhir}` : "-"),
            teks_dokumen: extracted.teks_asli || "-",
            kode_jenis: extracted.kode_jenis || "PB",
            tgl_terbit: extracted.tgl_terbit || extracted.tgl_awal || "-",
            tgl_awal: extracted.tgl_awal || "-",
            tgl_akhir: extracted.tgl_akhir || "-",
            durasi_hk: String(extracted.durasi_hk || calculateDays(extracted.masa_berlaku) || "-"),
            env: APP_ENV
          };

          await fetch(`${API_URL}/api/documents`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          // Mark as done
          setBatchFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, status: "done", data: extracted } : f
            )
          );
          successCount++;
        } else {
          throw new Error(result.detail || "Gagal mengekstrak dokumen");
        }
      } catch (err: any) {
        errorCount++;
        setBatchFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "error", errorMsg: err.message || "Gagal diproses" } : f
          )
        );
      }

      // Safe pause 1.2s between requests to prevent RPM/TPM rate limits
      if (i < batchFiles.length - 1 && !stopBatchRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }

    setIsBatchProcessing(false);
    await fetchDocuments();

    if (successCount > 0 && errorCount === 0) {
      toast.success(`Semua ${successCount} dokumen batch berhasil diproses & disinkronkan ke Google Sheets! 🎉`);
    } else if (successCount > 0 && errorCount > 0) {
      toast.warning(`${successCount} dokumen berhasil, ${errorCount} dokumen gagal.`);
    }
  };

  const handleStopBatch = () => {
    stopBatchRef.current = true;
    setIsBatchProcessing(false);
  };

  const handleRetryBatchItem = async (id: string) => {
    const targetItem = batchFiles.find((f) => f.id === id);
    if (!targetItem || isBatchProcessing) return;

    setBatchFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: "processing", errorMsg: undefined } : f))
    );

    try {
      const formData = new FormData();
      formData.append("file", targetItem.file);

      const res = await fetch(`${API_URL}/api/extract`, {
        method: "POST",
        body: formData,
      });
      const result = await res.json();

      if (res.ok && result.status === "success" && result.data) {
        const extracted = result.data;
        const payload = {
          nama_klien: extracted.principal || "-",
          jenis_dokumen: extracted.jenis_jaminan || "-",
          nomor_identitas: extracted.nomor_jaminan || "-",
          nilai_proyek: extracted.nilai_jaminan || "-",
          obligee: extracted.obligee || "-",
          pekerjaan: extracted.pekerjaan || "-",
          masa_berlaku: extracted.masa_berlaku || (extracted.tgl_awal && extracted.tgl_akhir ? `${extracted.tgl_awal} s/d ${extracted.tgl_akhir}` : "-"),
          teks_dokumen: extracted.teks_asli || "-",
          kode_jenis: extracted.kode_jenis || "PB",
          tgl_terbit: extracted.tgl_terbit || extracted.tgl_awal || "-",
          tgl_awal: extracted.tgl_awal || "-",
          tgl_akhir: extracted.tgl_akhir || "-",
          durasi_hk: String(extracted.durasi_hk || calculateDays(extracted.masa_berlaku) || "-"),
          env: APP_ENV
        };

        await fetch(`${API_URL}/api/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        setBatchFiles((prev) =>
          prev.map((f) => (f.id === id ? { ...f, status: "done", data: extracted } : f))
        );
        await fetchDocuments();
        toast.success(`Dokumen ${targetItem.file.name} berhasil diproses ulang & disinkronkan! 🎉`);
      } else {
        throw new Error(result.detail || "Gagal diproses");
      }
    } catch (err: any) {
      setBatchFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: "error", errorMsg: err.message } : f))
      );
      toast.error(`Coba lagi gagal: ${err.message}`);
    }
  };

  const handleSave = async () => {
    if (!extractedData || isSaving) return;
    setIsSaving(true);
    
    const payload = {
      nama_klien: extractedData.principal || "-",
      jenis_dokumen: extractedData.jenis_jaminan || "-",
      nomor_identitas: extractedData.nomor_jaminan || "-",
      nilai_proyek: extractedData.nilai_jaminan || "-",
      obligee: extractedData.obligee || "-",
      pekerjaan: extractedData.pekerjaan || "-",
      masa_berlaku: extractedData.masa_berlaku || (extractedData.tgl_awal && extractedData.tgl_akhir ? `${extractedData.tgl_awal} s/d ${extractedData.tgl_akhir}` : "-"),
      teks_dokumen: extractedData.teks_asli || "-",
      kode_jenis: extractedData.kode_jenis || "PB",
      tgl_terbit: extractedData.tgl_terbit || extractedData.tgl_awal || "-",
      tgl_awal: extractedData.tgl_awal || "-",
      tgl_akhir: extractedData.tgl_akhir || "-",
      durasi_hk: String(extractedData.durasi_hk || calculateDays(extractedData.masa_berlaku) || "-"),
      env: APP_ENV
    };

    try {
      if (extractedData.id) {
        // Mode Edit (Update data yang sudah ada)
        await fetch(`${API_URL}/api/documents/${extractedData.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast.success("Dokumen berhasil diperbarui & disinkronkan!");
      } else {
        // Mode Simpan Baru
        await fetch(`${API_URL}/api/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast.success("Data berhasil disimpan & disinkronkan ke Google Sheets!");
      }
      
      setExtractedData(null);
      setFile(null);
      await fetchDocuments();
      setActiveTab("dashboard");
    } catch (err) {
      toast.error("Gagal menyimpan ke database.");
    } finally {
      setIsSaving(false);
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

  const evaluateCrossValidation = (doc: any) => {
    if (!doc) {
      return {
        overallStatus: "yellow" as const,
        score: 50,
        headline: "Menunggu data dokumen...",
        checks: []
      };
    }

    const checks: {
      id: string;
      label: string;
      status: "green" | "yellow" | "red";
      message: string;
      details?: string;
    }[] = [];

    // 1. Uji Silang Tanggal vs Durasi Hari HK
    const tglAwalStr = String(doc.tgl_awal || "").trim();
    const tglAkhirStr = String(doc.tgl_akhir || "").trim();
    const rawDurasi = String(doc.durasi_hk || "").replace(/\D/g, "");
    const durasiHk = rawDurasi ? parseInt(rawDurasi, 10) : 0;

    const parseDateHelper = (dStr: string): Date | null => {
      if (!dStr || dStr === "-") return null;
      const parts = dStr.split(/[\/\-]/);
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
          return new Date(year, month, day);
        }
      }
      return null;
    };

    const d1 = parseDateHelper(tglAwalStr);
    const d2 = parseDateHelper(tglAkhirStr);

    if (d1 && d2) {
      const diffMs = d2.getTime() - d1.getTime();
      if (diffMs < 0) {
        checks.push({
          id: "date_order",
          label: "Uji Rentang Tanggal",
          status: "red",
          message: "Tanggal Awal lebih besar dari Tanggal Akhir!",
          details: `${tglAwalStr} s/d ${tglAkhirStr}`
        });
      } else {
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        if (durasiHk > 0) {
          if (durasiHk === diffDays || durasiHk === diffDays + 1) {
            checks.push({
              id: "date_vs_duration",
              label: "Uji Tanggal & Durasi HK",
              status: "green",
              message: `Cocok Sempurna (${durasiHk} Hari sesuai rentang ${diffDays} hari kalender)`,
              details: `${tglAwalStr} s/d ${tglAkhirStr}`
            });
          } else if (Math.abs(durasiHk - diffDays) <= 4) {
            checks.push({
              id: "date_vs_duration",
              label: "Uji Tanggal & Durasi HK",
              status: "yellow",
              message: `Tercatat ${durasiHk} HK, selisih kalender ${diffDays} hari (Toleransi hari kerja)`,
              details: `Selisih wajar antara perhitungan hari kalender vs hari kerja dinas`
            });
          } else {
            checks.push({
              id: "date_vs_duration",
              label: "Uji Tanggal & Durasi HK",
              status: "red",
              message: `Selisih Signifikan: Tertulis ${durasiHk} HK tapi rentang tanggal ${diffDays} hari!`,
              details: `Mohon periksa kembali tanggal awal atau tanggal akhir`
            });
          }
        } else {
          checks.push({
            id: "date_vs_duration",
            label: "Durasi Waktu",
            status: "yellow",
            message: `Rentang ${diffDays} hari kalender (Durasi HK tidak tertera angka pasti)`
          });
        }
      }
    } else {
      checks.push({
        id: "date_vs_duration",
        label: "Uji Rentang Tanggal",
        status: "yellow",
        message: "Tanggal awal atau akhir belum terisi lengkap"
      });
    }

    // 2. Uji Silang Nilai Angka vs Terbilang
    const nilaiStr = String(doc.nilai_jaminan || doc.nilai_proyek || "").trim();
    const teksAsli = String(doc.teks_asli || doc.teks_dokumen || "").toLowerCase();
    const cleanDigits = nilaiStr.replace(/[^\d]/g, "");

    if (cleanDigits && cleanDigits.length >= 6) {
      const numVal = parseInt(cleanDigits, 10);
      const hasMiliar = teksAsli.includes("miliar") || teksAsli.includes("milyar");
      const hasJuta = teksAsli.includes("juta");

      if (numVal >= 1_000_000_000) {
        if (hasMiliar) {
          checks.push({
            id: "nominal_cross",
            label: "Uji Nominal vs Terbilang",
            status: "green",
            message: `Nominal skala Miliar (${nilaiStr}) terkonfirmasi pada kalimat terbilang dokumen`,
            details: `Kata 'Miliar' dan angka bersesuaian pada naskah asli`
          });
        } else {
          checks.push({
            id: "nominal_cross",
            label: "Uji Nominal vs Terbilang",
            status: "yellow",
            message: `Nominal skala Miliar (${nilaiStr}), pastikan terbilang di surat fisik sesuai`
          });
        }
      } else if (numVal >= 1_000_000) {
        if (hasJuta) {
          checks.push({
            id: "nominal_cross",
            label: "Uji Nominal vs Terbilang",
            status: "green",
            message: `Nominal skala Juta (${nilaiStr}) terkonfirmasi pada kalimat terbilang dokumen`,
            details: `Kata 'Juta' dan angka bersesuaian pada naskah asli`
          });
        } else {
          checks.push({
            id: "nominal_cross",
            label: "Uji Nominal vs Terbilang",
            status: "yellow",
            message: `Nominal ${nilaiStr} terdeteksi, kalimat terbilang tertutup cap atau belum terbaca`
          });
        }
      } else {
        checks.push({
          id: "nominal_cross",
          label: "Nominal Jaminan",
          status: "green",
          message: `Nilai jaminan: ${nilaiStr}`
        });
      }
    } else if (!nilaiStr || nilaiStr === "-") {
      checks.push({
        id: "nominal_cross",
        label: "Nominal Jaminan",
        status: "red",
        message: "Nilai jaminan kosong atau belum terisi!"
      });
    } else {
      checks.push({
        id: "nominal_cross",
        label: "Nominal Jaminan",
        status: "yellow",
        message: `Nilai jaminan: ${nilaiStr} (Format angka perlu ditinjau)`
      });
    }

    // 3. Uji Nomor Dokumen & Legalitas
    const noJaminan = String(doc.nomor_jaminan || doc.nomor_identitas || "").trim();
    if (!noJaminan || noJaminan === "-") {
      checks.push({
        id: "doc_number",
        label: "Nomor Dokumen",
        status: "red",
        message: "Nomor Polis / Dokumen Jaminan belum terisi!"
      });
    } else if (noJaminan.toUpperCase().includes("SPPBJ") || noJaminan.toUpperCase().startsWith("BJ.") || noJaminan.includes("/")) {
      checks.push({
        id: "doc_number",
        label: "Status Legalitas Nomor Dokumen",
        status: "yellow",
        message: `Formulir Permohonan (Nomor Dasar SPPBJ: ${noJaminan})`,
        details: "Dokumen ini terdeteksi sebagai formulir pengajuan; nomor sertifikat polis resmi belum dicetak"
      });
    } else {
      checks.push({
        id: "doc_number",
        label: "Nomor Polis Resmi",
        status: "green",
        message: `Nomor Polis Resmi Terverifikasi: ${noJaminan}`
      });
    }

    // 4. Uji Kelengkapan Pihak Penjaminan
    const principal = String(doc.principal || doc.nama_klien || "").trim();
    const obligee = String(doc.obligee || "").trim();
    const pekerjaan = String(doc.pekerjaan || "").trim();

    const missingEntities: string[] = [];
    if (!principal || principal === "-") missingEntities.push("Principal (Klien)");
    if (!obligee || obligee === "-") missingEntities.push("Obligee (Penerima)");
    if (!pekerjaan || pekerjaan === "-") missingEntities.push("Nama Pekerjaan / Proyek");

    if (missingEntities.length === 0) {
      checks.push({
        id: "entities_check",
        label: "Kelengkapan Pihak Penjaminan",
        status: "green",
        message: "Seluruh entitas (Principal, Obligee, & Nama Proyek) lengkap terisi"
      });
    } else if (missingEntities.length === 1) {
      checks.push({
        id: "entities_check",
        label: "Kelengkapan Pihak Penjaminan",
        status: "yellow",
        message: `Ada 1 informasi belum lengkap: ${missingEntities.join(", ")}`
      });
    } else {
      checks.push({
        id: "entities_check",
        label: "Kelengkapan Pihak Penjaminan",
        status: "red",
        message: `Entitas penting belum lengkap: ${missingEntities.join(", ")}`
      });
    }

    const redCount = checks.filter(c => c.status === "red").length;
    const yellowCount = checks.filter(c => c.status === "yellow").length;

    let overallStatus: "green" | "yellow" | "red" = "green";
    let score = 100;
    let headline = "Status Dokumen: Terverifikasi Valid dan Aman";

    if (redCount > 0) {
      overallStatus = "red";
      score = Math.max(35, 100 - (redCount * 30) - (yellowCount * 10));
      headline = "Perhatian: Ditemukan Ketidakcocokan Data";
    } else if (yellowCount > 0) {
      overallStatus = "yellow";
      score = Math.max(65, 100 - (yellowCount * 12));
      headline = "Pemberitahuan: Dokumen Memerlukan Tinjauan";
    }

    return {
      overallStatus,
      score,
      headline,
      checks
    };
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

  const handleCopyExcel = () => {
    if (!extractedData) return;
    const noPolis = extractedData.nomor_jaminan && extractedData.nomor_jaminan !== "-" ? extractedData.nomor_jaminan : "";
    const jenisBond = extractedData.kode_jenis || (
      extractedData.jenis_jaminan?.toLowerCase().includes("pemeliharaan") ? "MB" :
      extractedData.jenis_jaminan?.toLowerCase().includes("pelaksanaan") ? "PB" :
      extractedData.jenis_jaminan?.toLowerCase().includes("uang muka") ? "APB" :
      extractedData.jenis_jaminan?.toLowerCase().includes("penawaran") ? "BB" : "PB"
    );
    const principal = extractedData.principal || "";
    const obligee = extractedData.obligee || "";
    const pekerjaan = extractedData.pekerjaan || "";
    const nilaiBond = extractedData.nilai_jaminan || "";
    const tglTerbit = extractedData.tgl_terbit || extractedData.tgl_awal || "";
    const tglAwal = extractedData.tgl_awal || "";
    const tglAkhir = extractedData.tgl_akhir || "";
    const durasiHK = extractedData.durasi_hk || calculateDays(extractedData.masa_berlaku) || "";

    // Tab-separated values: NO. POLIS | JENIS BOND | PRINCIPAL | OBLIGEE | PEKERJAAN | NILAI BOND | TGL TERBIT | TGL AWAL | TGL AKHIR | HK
    const rowTsv = [noPolis, jenisBond, principal, obligee, pekerjaan, nilaiBond, tglTerbit, tglAwal, tglAkhir, durasiHK].join("\t");

    navigator.clipboard.writeText(rowTsv);
    setIsCopiedExcel(true);
    toast.success("Format baris Excel disalin! Siap paste (Ctrl+V) langsung ke Excel.");
    setTimeout(() => setIsCopiedExcel(false), 2500);
  };

  const handleCopyText = () => {
    if (!extractedData) return;
    const days = extractedData.durasi_hk || calculateDays(extractedData.masa_berlaku);
    const durationText = days ? ` (${days} Hari)` : "";

    const textToCopy = [
      `No. Polis     : ${extractedData.nomor_jaminan || "-"}`,
      `Jenis Bond    : ${extractedData.kode_jenis || "PB"} - ${extractedData.jenis_jaminan || "-"}`,
      `Principal     : ${extractedData.principal || "-"}`,
      `Obligee       : ${extractedData.obligee || "-"}`,
      `Nilai Bond    : ${extractedData.nilai_jaminan || "-"}`,
      `Pekerjaan     : ${extractedData.pekerjaan || "-"}`,
      `Tgl Terbit    : ${extractedData.tgl_terbit || "-"}`,
      `Jangka Waktu  : ${extractedData.tgl_awal || "-"} s/d ${extractedData.tgl_akhir || "-"}${durationText}`
    ].join("\n");

    navigator.clipboard.writeText(textToCopy);
    setIsCopiedText(true);
    toast.success("Rangkuman teks berhasil disalin ke clipboard!");
    setTimeout(() => setIsCopiedText(false), 2500);
  };

  const handleCopyOcr = () => {
    if (!extractedData?.teks_asli) return;
    navigator.clipboard.writeText(extractedData.teks_asli);
    setIsCopiedOcr(true);
    toast.success("Teks dokumen asli berhasil disalin!");
    setTimeout(() => setIsCopiedOcr(false), 2500);
  };

  const handleOpenSpreadsheet = () => {
    const savedUrl = typeof window !== "undefined" ? localStorage.getItem("google_sheets_url") : null;
    if (savedUrl && savedUrl.startsWith("http")) {
      window.open(savedUrl, "_blank");
    } else {
      const inputUrl = window.prompt(
        "Masukkan Link Google Spreadsheet Anda (contoh: https://docs.google.com/spreadsheets/d/...):",
        savedUrl || "https://docs.google.com/spreadsheets"
      );
      if (inputUrl && inputUrl.trim().startsWith("http")) {
        localStorage.setItem("google_sheets_url", inputUrl.trim());
        toast.success("Link Google Spreadsheet berhasil disimpan!");
        window.open(inputUrl.trim(), "_blank");
      }
    }
  };



  return (
    <main className="min-h-screen px-4 sm:px-8 py-10 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl sm:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-600 tracking-tight">
              Ekstraktor Asuransi AI
            </h1>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              🧪 Testing Lab (Tab: TESTING)
            </span>
          </div>
          <p className="text-slate-400 mt-2 text-sm sm:text-base">Laboratorium Uji Coba Dokumen Asuransi (Data Terisolasi)</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 self-start md:self-auto">
          <button 
            onClick={handleOpenSpreadsheet}
            className="px-4 py-2.5 rounded-full text-xs font-bold bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-500/50 hover:border-emerald-400 transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-emerald-950/40"
            title="Buka Google Spreadsheet kantor di tab baru"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Buka Google Sheets ↗</span>
          </button>

          <div className="glass-panel rounded-full p-1.5 flex gap-2 shadow-lg shadow-black/20">
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

                <a 
                  href={`${API_URL}/api/documents/export/excel`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-600/25 flex items-center gap-2 border border-emerald-400/40 cursor-pointer self-stretch sm:self-auto justify-center"
                >
                  <svg className="w-4 h-4 text-emerald-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span>Unduh File Excel (.xlsx)</span>
                </a>
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
                        <td className="p-4 font-medium text-white">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <span>{doc.nama_klien}</span>
                            {(() => {
                              const rowVal = evaluateCrossValidation(doc);
                              const isG = rowVal.overallStatus === "green";
                              const isY = rowVal.overallStatus === "yellow";
                              return (
                                <span 
                                  title={`${rowVal.headline} (Akurasi: ${rowVal.score}%)`}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border shrink-0 ${
                                    isG 
                                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" 
                                      : isY
                                      ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                                      : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                                  }`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${
                                    isG ? "bg-emerald-400" : isY ? "bg-amber-400" : "bg-rose-400"
                                  }`} />
                                  {isG ? "Terverifikasi" : isY ? "Tinjau" : "Periksa"}
                                </span>
                              );
                            })()}
                          </div>
                        </td>
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
                                kode_jenis: doc.kode_jenis || (doc.jenis_dokumen?.toLowerCase().includes("pemeliharaan") ? "MB" : doc.jenis_dokumen?.toLowerCase().includes("uang muka") ? "APB" : doc.jenis_dokumen?.toLowerCase().includes("penawaran") ? "BB" : "PB"),
                                nomor_jaminan: doc.nomor_identitas,
                                nilai_jaminan: doc.nilai_proyek,
                                obligee: doc.obligee,
                                pekerjaan: doc.pekerjaan,
                                masa_berlaku: doc.masa_berlaku,
                                tgl_terbit: doc.tgl_terbit || "",
                                tgl_awal: doc.tgl_awal || "",
                                tgl_akhir: doc.tgl_akhir || "",
                                durasi_hk: doc.durasi_hk || "",
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
        <div className="space-y-6">
          {/* Mode Switcher: Dokumen Tunggal vs Batch Multi-Dokumen */}
          <div className="flex justify-center">
            <div className="glass-panel p-1.5 rounded-2xl flex gap-2 border border-slate-700/70 shadow-xl shadow-black/30">
              <button
                type="button"
                onClick={() => setUploadMode("single")}
                className={`px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                  uploadMode === "single"
                    ? "bg-sky-500 text-white shadow-md shadow-sky-500/30 ring-1 ring-sky-300"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Dokumen Tunggal</span>
              </button>

              <button
                type="button"
                onClick={() => setUploadMode("batch")}
                className={`px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                  uploadMode === "batch"
                    ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30 ring-1 ring-emerald-300"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span>Batch Multi-Dokumen</span>
                <span className="bg-emerald-950 text-emerald-300 border border-emerald-400/40 text-[10px] font-black px-1.5 py-0.5 rounded-md">
                  Auto-Sync
                </span>
              </button>
            </div>
          </div>

          {/* 1. VIEW MODE TUNGGAL */}
          {uploadMode === "single" ? (
            <div className={extractedData ? "grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-[1600px] mx-auto w-full" : "max-w-2xl mx-auto space-y-6 pt-2 pb-12"}>
              {/* KOLOM KIRI: Upload & Data Terstruktur (50% Split) */}
              <div className={extractedData ? "lg:col-span-6 space-y-6" : ""}>
                {/* Kotak Upload */}
                <div className={`glass-panel rounded-3xl text-center border-dashed border-2 border-slate-600 hover:border-sky-500 transition-colors ${extractedData ? "p-6" : "p-10 sm:p-14"}`}>
                  <div className="w-12 h-12 mx-auto bg-slate-800 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                  </div>
                  <h2 className="text-lg font-semibold mb-1">Upload Dokumen</h2>
                  <p className="text-slate-400 mb-4 text-xs">Pilih file PDF, JPG, atau PNG.</p>
                  
                  <input type="file" onChange={handleFileChange} className="hidden" id="file-upload" />
                  <label htmlFor="file-upload" className="cursor-pointer bg-slate-800 hover:bg-slate-700 text-white px-6 py-2.5 rounded-full text-xs font-semibold transition-colors inline-block mb-2 border border-slate-600/60">
                    {file ? file.name : "Browse Files"}
                  </label>
                  
                  {file && (
                    <div className="mt-3">
                      <button 
                        onClick={handleUpload} 
                        disabled={isUploading}
                        className="bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white px-8 py-2.5 rounded-full text-xs font-bold shadow-lg shadow-sky-500/25 transition-all w-full disabled:opacity-50 cursor-pointer"
                      >
                        {isUploading ? "Memproses AI..." : "Ekstrak Sekarang"}
                      </button>
                    </div>
                  )}
                </div>

                {/* Kotak Form Data Terstruktur */}
                {extractedData && (
                  <div className="glass-panel p-6 sm:p-7 rounded-3xl animate-in fade-in slide-in-from-left-8 duration-500 border border-slate-700/70 shadow-2xl">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-700/60">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.9)] shrink-0"></div>
                        <div>
                          <h2 className="text-lg font-bold text-white tracking-tight">Data Terstruktur</h2>
                          <button 
                            onClick={handleOpenSpreadsheet}
                            className="flex items-center gap-1.5 mt-0.5 text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold hover:underline cursor-pointer group"
                            title="Klik untuk membuka Google Spreadsheet"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            <span>Terhubung Google Sheets ↗</span>
                          </button>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={handleCopyExcel}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border shadow-sm cursor-pointer whitespace-nowrap ${
                            isCopiedExcel 
                              ? "bg-emerald-500/30 text-emerald-300 border-emerald-400 shadow-emerald-950/50 scale-105" 
                              : "bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border-emerald-700/60 hover:border-emerald-500"
                          }`}
                          title="Salin 1 baris format tabel Excel"
                        >
                          {isCopiedExcel ? (
                            <>
                              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                              <span>Tersalin!</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                              <span>Salin Excel</span>
                            </>
                          )}
                        </button>

                        <button 
                          onClick={handleCopyText}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border shadow-sm cursor-pointer whitespace-nowrap ${
                            isCopiedText 
                              ? "bg-sky-500/30 text-sky-300 border-sky-400 shadow-sky-950/50 scale-105" 
                              : "bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700 hover:border-slate-600"
                          }`}
                          title="Salin ringkasan teks"
                        >
                          {isCopiedText ? (
                            <>
                              <svg className="w-3.5 h-3.5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                              <span>Tersalin!</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                              <span>Salin Teks</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                    
                    {/* 🛡️ Traffic Light System: AI Cross-Validation Banner (Premium Executive Design) */}
                    {(() => {
                      const valResult = evaluateCrossValidation(extractedData);
                      const isGreen = valResult.overallStatus === "green";
                      const isYellow = valResult.overallStatus === "yellow";
                      const isRed = valResult.overallStatus === "red";

                      return (
                        <div className={`p-5 rounded-2xl border transition-all mb-6 shadow-xl ${
                          isGreen
                            ? "bg-slate-900/90 border-emerald-500/50 shadow-emerald-950/20"
                            : isYellow
                            ? "bg-slate-900/90 border-amber-500/50 shadow-amber-950/20"
                            : "bg-slate-900/90 border-rose-500/50 shadow-rose-950/20"
                        }`}>
                          <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-start sm:items-center gap-3.5">
                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                                isGreen 
                                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" 
                                  : isYellow
                                  ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                                  : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                              }`}>
                                {isGreen ? (
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M5 13l4 4L19 7" /></svg>
                                ) : isYellow ? (
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                ) : (
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                )}
                              </div>
                              <div>
                                <div className="flex items-center gap-2.5 flex-wrap">
                                  <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                                    {valResult.headline}
                                  </h3>
                                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                                    isGreen
                                      ? "bg-emerald-950 text-emerald-300 border-emerald-500/40"
                                      : isYellow
                                      ? "bg-amber-950 text-amber-300 border-amber-500/40"
                                      : "bg-rose-950 text-rose-300 border-rose-500/40"
                                  }`}>
                                    Akurasi: {valResult.score}%
                                  </span>
                                </div>
                                <p className="text-sm text-slate-300 mt-0.5 leading-relaxed">
                                  Sistem audit AI telah menguji silang nilai nominal, rentang tanggal kalender, dan keabsahan nomor dokumen.
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowValidationDetail(!showValidationDetail)}
                              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 transition-all cursor-pointer shadow-sm"
                            >
                              {showValidationDetail ? "Tutup Rincian Audit" : "Lihat Rincian Validasi Silang"}
                            </button>
                          </div>

                          {/* Accordion Rincian Validasi Silang */}
                          {showValidationDetail && (
                            <div className="mt-5 pt-4 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-3.5 animate-in fade-in duration-300">
                              {valResult.checks.map((c) => {
                                const checkGreen = c.status === "green";
                                const checkYellow = c.status === "yellow";

                                return (
                                  <div 
                                    key={c.id} 
                                    className={`p-4 rounded-xl border bg-slate-950/70 transition-all ${
                                      checkGreen
                                        ? "border-emerald-500/30 shadow-sm"
                                        : checkYellow
                                        ? "border-amber-500/30 shadow-sm"
                                        : "border-rose-500/40 shadow-sm"
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-2 mb-1.5">
                                      <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${
                                          checkGreen ? "bg-emerald-400" : checkYellow ? "bg-amber-400" : "bg-rose-400"
                                        }`} />
                                        <span className="text-sm font-bold text-white tracking-wide">
                                          {c.label}
                                        </span>
                                      </div>
                                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${
                                        checkGreen
                                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                          : checkYellow
                                          ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                                          : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                                      }`}>
                                        {checkGreen ? "Sesuai" : checkYellow ? "Tinjau" : "Selisih"}
                                      </span>
                                    </div>
                                    <div className="text-sm text-slate-200 font-medium leading-relaxed">
                                      {c.message}
                                    </div>
                                    {c.details && (
                                      <div className="text-xs text-slate-400 mt-2 p-2 rounded-lg bg-slate-900/90 border border-slate-800/80 font-mono">
                                        {c.details}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    
                    <div className="space-y-4 mb-6">
                      {/* Row 1: Nomor Polis & Jenis Bond */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                        <div className="sm:col-span-4">
                          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">No. Polis / Jaminan</label>
                          <input 
                            type="text" 
                            value={extractedData.nomor_jaminan || ""} 
                            onFocus={() => highlightInSource(extractedData.nomor_jaminan)} 
                            onChange={(e) => setExtractedData({...extractedData, nomor_jaminan: e.target.value})} 
                            className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm" 
                          />
                        </div>
                        <div className="sm:col-span-8">
                          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Jenis Bond</label>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                            {[
                              { code: "PB", name: "PB", desc: "Pelaksanaan" },
                              { code: "MB", name: "MB", desc: "Pemeliharaan" },
                              { code: "APB", name: "APB", desc: "Uang Muka" },
                              { code: "BB", name: "BB", desc: "Penawaran" }
                            ].map((b) => {
                              const isSelected = (extractedData.kode_jenis === b.code) || (!extractedData.kode_jenis && extractedData.jenis_jaminan?.toLowerCase().includes(b.desc.toLowerCase()));
                              return (
                                <button
                                  key={b.code}
                                  type="button"
                                  title={`${b.code} - Jaminan ${b.desc}`}
                                  onClick={() => setExtractedData({
                                    ...extractedData, 
                                    kode_jenis: b.code,
                                    jenis_jaminan: `${b.code} - Jaminan ${b.desc}`
                                  })}
                                  className={`cursor-pointer px-1 sm:px-2 py-1.5 rounded-xl text-center transition-all border ${
                                    isSelected
                                      ? "bg-sky-500 text-white border-sky-400 shadow-md shadow-sky-500/30 ring-1 ring-sky-300 scale-102 font-bold"
                                      : "bg-slate-900/80 text-slate-300 border-slate-700/80 hover:bg-slate-800 hover:text-white hover:border-slate-600"
                                  }`}
                                >
                                  <div className="text-xs font-black tracking-wide leading-none">{b.code}</div>
                                  <div className="text-[9px] sm:text-[10px] opacity-85 mt-1 leading-tight tracking-tight whitespace-normal">{b.desc}</div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Row 2: Principal */}
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Principal (Pemohon / Terjamin)</label>
                        <input 
                          type="text" 
                          value={extractedData.principal || ""} 
                          onFocus={() => highlightInSource(extractedData.principal)} 
                          onChange={(e) => setExtractedData({...extractedData, principal: e.target.value})} 
                          className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm" 
                        />
                      </div>

                      {/* Row 3: Obligee */}
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Obligee (Penerima Jaminan / Pemilik Proyek / PPK)</label>
                        <input 
                          type="text" 
                          value={extractedData.obligee || ""} 
                          onFocus={() => highlightInSource(extractedData.obligee)} 
                          onChange={(e) => setExtractedData({...extractedData, obligee: e.target.value})} 
                          className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm" 
                        />
                      </div>

                      {/* Row 4: Nilai Bond & Tanggal Terbit */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Nilai Bond (Jaminan)</label>
                          <input 
                            type="text" 
                            value={extractedData.nilai_jaminan || ""} 
                            onFocus={() => highlightInSource(extractedData.nilai_jaminan)} 
                            onChange={(e) => setExtractedData({...extractedData, nilai_jaminan: e.target.value})} 
                            className="w-full glass-input rounded-xl px-3.5 py-2.5 font-bold text-emerald-400 text-sm" 
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Tanggal Terbit</label>
                          <input 
                            type="text" 
                            value={extractedData.tgl_terbit && extractedData.tgl_terbit !== "-" ? extractedData.tgl_terbit : (extractedData.tgl_awal && extractedData.tgl_awal !== "-" ? extractedData.tgl_awal : "")} 
                            placeholder="DD/MM/YYYY" 
                            onFocus={() => highlightInSource(extractedData.tgl_terbit)} 
                            onChange={(e) => setExtractedData({...extractedData, tgl_terbit: e.target.value})} 
                            className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm" 
                          />
                        </div>
                      </div>

                      {/* Row 5: Jangka Waktu (Masa Berlaku) */}
                      <div className="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-700/60 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">Jangka Waktu Jaminan</label>
                          {(() => {
                            const days = (extractedData.durasi_hk && extractedData.durasi_hk !== "-") ? extractedData.durasi_hk : calculateDays(extractedData.masa_berlaku) || (
                              extractedData.tgl_awal && extractedData.tgl_akhir && extractedData.tgl_awal !== "-" && extractedData.tgl_akhir !== "-" ? calculateDays(`${extractedData.tgl_awal} s/d ${extractedData.tgl_akhir}`) : null
                            );
                            if (days) {
                              return (
                                <span className="bg-sky-950 text-sky-300 border border-sky-500/40 text-[11px] font-bold px-2 py-0.5 rounded-lg flex items-center gap-1">
                                  <svg className="w-3 h-3 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  {days} Hari Kerja (HK)
                                </span>
                              );
                            }
                            return null;
                          })()}
                        </div>

                        <div className="grid grid-cols-3 gap-2.5">
                          <div>
                            <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">Tgl Awal</span>
                            <input 
                              type="text" 
                              placeholder="DD/MM/YYYY"
                              value={extractedData.tgl_awal && extractedData.tgl_awal !== "-" ? extractedData.tgl_awal : ""} 
                              onFocus={() => highlightInSource(extractedData.tgl_awal)} 
                              onChange={(e) => setExtractedData({...extractedData, tgl_awal: e.target.value})} 
                              className="w-full glass-input rounded-xl px-2.5 py-2 text-xs text-center" 
                            />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">Tgl Akhir</span>
                            <input 
                              type="text" 
                              placeholder="DD/MM/YYYY"
                              value={extractedData.tgl_akhir && extractedData.tgl_akhir !== "-" ? extractedData.tgl_akhir : ""} 
                              onFocus={() => highlightInSource(extractedData.tgl_akhir)} 
                              onChange={(e) => setExtractedData({...extractedData, tgl_akhir: e.target.value})} 
                              className="w-full glass-input rounded-xl px-2.5 py-2 text-xs text-center" 
                            />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">Hari (HK)</span>
                            <input 
                              type="text" 
                              placeholder="Contoh: 120"
                              value={extractedData.durasi_hk && extractedData.durasi_hk !== "-" ? extractedData.durasi_hk : ""} 
                              onFocus={() => highlightInSource(extractedData.durasi_hk)} 
                              onChange={(e) => setExtractedData({...extractedData, durasi_hk: e.target.value})} 
                              className="w-full glass-input rounded-xl px-2.5 py-2 text-xs text-center font-bold text-sky-400" 
                            />
                          </div>
                        </div>
                      </div>

                      {/* Row 6: Pekerjaan */}
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Nama Pekerjaan / Proyek</label>
                        <textarea 
                          rows={3} 
                          value={extractedData.pekerjaan || ""} 
                          onFocus={() => highlightInSource(extractedData.pekerjaan)} 
                          onChange={(e) => setExtractedData({...extractedData, pekerjaan: e.target.value})} 
                          className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm resize-none overflow-y-auto" 
                        />
                      </div>
                    </div>

                    {/* Bottom Buttons */}
                    <div className="flex gap-3">
                      <button 
                        onClick={handleSave} 
                        disabled={isSaving}
                        className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-lg shadow-emerald-500/25 transition-all flex-1 cursor-pointer flex items-center justify-center gap-2"
                      >
                        {isSaving ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>Menyimpan...</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                            </svg>
                            <span>Simpan ke Database & Google Sheets</span>
                          </>
                        )}
                      </button>
                      {extractedData.id && (
                        <button onClick={() => fetchAuditLogs(extractedData.id)} className="bg-slate-800 hover:bg-slate-700 text-sky-400 px-4 py-3 rounded-xl font-semibold text-xs border border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          Riwayat
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* KOLOM KANAN (50%): Dokumen Asli OCR */}
              {extractedData && (
                <div className="lg:col-span-6">
                  <div className="glass-panel rounded-3xl animate-in fade-in slide-in-from-right-8 duration-500 overflow-hidden bg-[#1e293b]/90 border border-slate-700/80 shadow-2xl flex flex-col h-full min-h-[700px]">
                    {/* Header OCR */}
                    <div className="bg-slate-900/90 px-6 py-4 border-b border-slate-700/80 flex justify-between items-center shrink-0">
                      <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                        <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Dokumen Asli (OCR)</h2>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={handleCopyOcr}
                          className={`text-xs px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 border cursor-pointer ${
                            isCopiedOcr 
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50" 
                              : "bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600/70"
                          }`}
                        >
                          {isCopiedOcr ? (
                            <>
                              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                              <span>Tersalin!</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                              <span>Salin Teks</span>
                            </>
                          )}
                        </button>

                        <button 
                          onClick={() => setIsEditMode(!isEditMode)}
                          className="text-xs bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-600/70 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                          {isEditMode ? "Mode Tampilan" : "Edit Teks"}
                        </button>
                      </div>
                    </div>

                    {/* Content OCR Body */}
                    <div className="p-5 flex-1 flex flex-col">
                      {isEditMode ? (
                        <textarea 
                          rows={30} 
                          value={extractedData.teks_asli || ""} 
                          onChange={(e) => setExtractedData({...extractedData, teks_asli: e.target.value})} 
                          className="w-full flex-1 min-h-[600px] bg-[#0f172a]/70 text-slate-200 p-6 rounded-2xl font-sans text-sm sm:text-base leading-relaxed resize-none focus:outline-none focus:bg-[#0f172a]/90 transition-colors border border-slate-700/60 shadow-inner"
                          placeholder="Teks dokumen akan muncul di sini..."
                        />
                      ) : (
                        <div className="w-full flex-1 min-h-[600px] bg-[#0f172a]/70 text-slate-200 p-6 rounded-2xl font-sans text-sm sm:text-base leading-relaxed whitespace-pre-wrap border border-slate-700/60 shadow-inner overflow-y-auto">
                          {renderHighlightedText(extractedData.teks_asli || "", highlightedWord)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* 2. VIEW MODE BATCH MULTI-DOKUMEN */
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300">
              {/* Batch Dropzone */}
              <div className="glass-panel rounded-3xl p-8 sm:p-10 text-center border-dashed border-2 border-slate-600 hover:border-emerald-500 transition-colors shadow-2xl">
                <div className="w-16 h-16 mx-auto bg-emerald-950/60 rounded-full flex items-center justify-center mb-4 border border-emerald-500/30 shadow-lg shadow-emerald-950/40">
                  <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-white mb-1">Unggah Banyak Dokumen (Batch)</h2>
                <p className="text-slate-400 text-xs max-w-md mx-auto mb-5 leading-relaxed">
                  Pilih hingga 20+ file PDF atau Gambar sekaligus. AI akan memproses dokumen secara berurutan dan otomatis menyimpannya ke Google Spreadsheet secara instan.
                </p>
                
                <input 
                  type="file" 
                  multiple 
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleBatchFilesSelect} 
                  className="hidden" 
                  id="batch-file-upload" 
                />
                <label 
                  htmlFor="batch-file-upload" 
                  className="cursor-pointer bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-8 py-3 rounded-full text-xs font-bold shadow-lg shadow-emerald-600/25 transition-all inline-flex items-center gap-2 border border-emerald-400/40"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                  Pilih Banyak File Sekaligus
                </label>
              </div>

              {/* Batch Queue List & Progress Controller */}
              {batchFiles.length > 0 && (
                <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-slate-700/80 shadow-2xl space-y-6">
                  {/* Header Controller */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-5 border-b border-slate-700/60">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-bold text-white tracking-tight">Antrian Pemrosesan Batch</h3>
                        <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">
                          {batchFiles.length} File
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs">
                        <span className="text-emerald-400 font-semibold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                          {batchFiles.filter(f => f.status === "done").length} Selesai
                        </span>
                        <span className="text-sky-400 font-semibold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
                          {batchFiles.filter(f => f.status === "processing").length} Diproses
                        </span>
                        <span className="text-slate-400 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
                          {batchFiles.filter(f => f.status === "pending").length} Menunggu
                        </span>
                        {batchFiles.some(f => f.status === "error") && (
                          <span className="text-red-400 font-semibold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                            {batchFiles.filter(f => f.status === "error").length} Gagal
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Batch Action Buttons */}
                    <div className="flex items-center gap-2 self-stretch sm:self-auto">
                      {isBatchProcessing ? (
                        <button
                          onClick={handleStopBatch}
                          className="bg-red-600 hover:bg-red-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg shadow-red-600/30 flex items-center justify-center gap-2 cursor-pointer w-full sm:w-auto"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                          </svg>
                          <span>Hentikan Antrian</span>
                        </button>
                      ) : (
                        <button
                          onClick={startBatchProcessing}
                          disabled={batchFiles.every(f => f.status === "done")}
                          className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white px-6 py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed w-full sm:w-auto"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>Mulai Proses Antrian ({batchFiles.filter(f => f.status !== "done").length})</span>
                        </button>
                      )}

                      {!isBatchProcessing && (
                        <button
                          onClick={handleClearBatch}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3.5 py-2.5 rounded-xl text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
                          title="Bersihkan Semua Antrian"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar & Success Confirmation Banner */}
                  {(() => {
                    const doneCount = batchFiles.filter(f => f.status === "done").length;
                    const percent = Math.round((doneCount / batchFiles.length) * 100);
                    const activeItem = batchFiles.find(f => f.status === "processing");
                    const allDone = doneCount === batchFiles.length;

                    return (
                      <div className="space-y-3">
                        {allDone ? (
                          <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/80 to-teal-950/80 border border-emerald-500/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg shadow-emerald-950/50 animate-in fade-in">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 flex items-center justify-center shrink-0">
                                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-white">Semua {doneCount} Dokumen Berhasil Disimpan Otomatis!</h4>
                                <p className="text-xs text-emerald-300/90 mt-0.5">
                                  Data sudah masuk ke Database dan otomatis tertulis di baris Google Spreadsheet.
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 self-stretch sm:self-auto shrink-0">
                              <button
                                onClick={() => setActiveTab("dashboard")}
                                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 hover:text-white border border-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                                </svg>
                                <span>Lihat Arsip</span>
                              </button>

                              <button
                                onClick={() => window.open(`${API_URL}/api/documents/export/excel`, "_blank")}
                                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/30 cursor-pointer flex items-center justify-center gap-1.5"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <span>Unduh Excel</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex justify-between text-xs font-semibold">
                              <span className="text-slate-300">
                                {isBatchProcessing && activeItem ? (
                                  <span className="text-sky-400 flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping"></span>
                                    Memproses: {activeItem.file.name}
                                  </span>
                                ) : (
                                  <span>Progress Antrian</span>
                                )}
                              </span>
                              <span className="text-slate-400 font-mono">{percent}% ({doneCount}/{batchFiles.length})</span>
                            </div>
                            <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-700/60 p-0.5">
                              <div 
                                className="bg-gradient-to-r from-sky-500 via-teal-500 to-emerald-500 h-full rounded-full transition-all duration-500 ease-out" 
                                style={{ width: `${percent}%` }}
                              ></div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* File Queue List */}
                  <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                    {batchFiles.map((item, idx) => (
                      <div 
                        key={item.id}
                        className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                          item.status === "processing"
                            ? "bg-sky-950/40 border-sky-500/50 shadow-lg shadow-sky-950/40 ring-1 ring-sky-400/30"
                            : item.status === "done"
                            ? "bg-emerald-950/20 border-emerald-700/40 hover:border-emerald-500/50"
                            : item.status === "error"
                            ? "bg-red-950/20 border-red-700/40"
                            : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            item.status === "processing" ? "bg-sky-900/60 text-sky-400" :
                            item.status === "done" ? "bg-emerald-900/60 text-emerald-400" :
                            item.status === "error" ? "bg-red-900/60 text-red-400" :
                            "bg-slate-800 text-slate-400"
                          }`}>
                            {item.status === "processing" ? (
                              <svg className="w-5 h-5 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                              </svg>
                            ) : item.status === "done" ? (
                              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                              </svg>
                            ) : item.status === "error" ? (
                              <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            ) : (
                              <span className="text-xs font-mono font-bold">{idx + 1}</span>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-white truncate">{item.file.name}</span>
                              <span className="text-[10px] text-slate-500 font-mono shrink-0">
                                ({(item.file.size / 1024 / 1024).toFixed(2)} MB)
                              </span>
                            </div>

                            {/* Detail summary on done */}
                            {item.status === "done" && item.data && (
                              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                                {(() => {
                                  const bVal = evaluateCrossValidation(item.data);
                                  const isG = bVal.overallStatus === "green";
                                  const isY = bVal.overallStatus === "yellow";
                                  return (
                                    <span 
                                      title={bVal.headline}
                                      className={`px-2.5 py-0.5 rounded-md font-semibold text-xs border flex items-center gap-1.5 ${
                                        isG
                                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                          : isY
                                          ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                                          : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                                      }`}
                                    >
                                      <span className={`w-1.5 h-1.5 rounded-full ${
                                        isG ? "bg-emerald-400" : isY ? "bg-amber-400" : "bg-rose-400"
                                      }`} />
                                      {isG ? "Terverifikasi" : isY ? "Tinjau" : "Periksa"} ({bVal.score}%)
                                    </span>
                                  );
                                })()}
                                <span className="px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-300 font-semibold text-[10px] border border-emerald-500/40 flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                  Tersimpan di Database & Sheets
                                </span>
                                <span className="px-2 py-0.5 rounded-md bg-sky-950 text-sky-300 font-mono font-bold text-[10px] border border-sky-700/50">
                                  {item.data.kode_jenis || "PB"}
                                </span>
                                <span className="text-slate-300 font-medium truncate max-w-[180px]">
                                  {item.data.principal || "-"}
                                </span>
                                <span className="text-emerald-400 font-semibold">
                                  {item.data.nilai_jaminan || "-"}
                                </span>
                              </div>
                            )}

                            {/* Error message on error */}
                            {item.status === "error" && (
                              <p className="text-xs text-red-400 mt-0.5">{item.errorMsg || "Gagal diproses"}</p>
                            )}
                          </div>
                        </div>

                        {/* Item Actions */}
                        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                          {item.status === "done" && (
                            <button
                              onClick={() => handleInspectBatchItem(item)}
                              className="bg-sky-900/50 hover:bg-sky-500 text-sky-300 hover:text-white px-3 py-1 rounded-xl text-xs font-semibold transition-all border border-sky-500/30 cursor-pointer flex items-center gap-1"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                              <span>Periksa / Edit</span>
                            </button>
                          )}

                          {item.status === "error" && (
                            <button
                              onClick={() => handleRetryBatchItem(item.id)}
                              disabled={isBatchProcessing}
                              className="bg-amber-900/50 hover:bg-amber-600 text-amber-300 hover:text-white px-3 py-1 rounded-xl text-xs font-semibold transition-all border border-amber-500/30 cursor-pointer flex items-center gap-1"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              <span>Coba Lagi</span>
                            </button>
                          )}

                          {!isBatchProcessing && item.status !== "processing" && (
                            <button
                              onClick={() => handleRemoveBatchItem(item.id)}
                              className="text-slate-500 hover:text-red-400 p-1 transition-colors cursor-pointer"
                              title="Hapus dari antrian"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
