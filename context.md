# CONTEXT PROYEK: SISTEM EKSTRAKSI OCR SURETY BOND & BANK GARANSI

Dokumen ini memuat arsitektur menyeluruh, alur kerja sistem, spesifikasi API, skema database, logika ekstraksi AI, dan panduan operasional proyek.

---

## 1. Ringkasan Eksekutif & Tujuan Bisnis

Sistem ini adalah platform otomasi ekstraksi dan registrasi dokumen **Surety Bond** (Jaminan Penawaran, Jaminan Pelaksanaan, Jaminan Uang Muka, Jaminan Pemeliharaan) serta **Bank Garansi / SPPBJ**. 

Tujuan utama sistem:
* Menggantikan input data manual register asuransi yang memakan waktu dan rentan salah ketik.
* Membaca file dokumen scan (PDF, JPG, PNG) secara otomatis menggunakan AI Vision dan LLM presisi tinggi.
* Menata data menjadi format terstruktur: Nomor Jaminan/Polis, Principal (Pemohon), Obligee (Penerima Jaminan), Nilai Jaminan (Rupiah), Nama Proyek/Pekerjaan, Masa Berlaku, dan Durasi Hari Kerja (HK).
* Menyimpan data ke database terpusat, mengunggah salinan arsip dokumen ke Google Drive, dan menyinkronkan data secara real-time ke Google Sheets register operasional klien.

---

## 2. Arsitektur & Tumpukan Teknologi (Tech Stack)

```
[ Klien / Browser ]
         |
         v
[ Frontend: Next.js 16 (App Router + Tailwind CSS) ]
  - Hosting: Vercel (Production: mydata2.vercel.app | Staging: mydata2-testing.vercel.app)
  - Fitur: Single & Batch Upload, Bulk Delete, Cross-Validation, Rekap Excel
         |
         v (REST API HTTPS)
[ Backend: FastAPI (Python 3.11) ]
  - Hosting: Render (mydata-201q.onrender.com)
  - Libs: PyMuPDF, Groq SDK, psycopg2, openpyxl, python-dotenv
         |
    +----+---------------------------+--------------------------+
    |                                |                          |
    v                                v                          v
[ AI Engine: Groq API ]    [ Database: Neon PostgreSQL ]   [ Google Cloud Integration ]
  - Vision OCR:              - Connection Pooling terkelola   - Apps Script Webhook
    qwen/qwen3.8-27b           (ThreadedConnectionPool 1-15) - Google Sheets Sync
  - Structuring & Retry:     - Tabel: dokumen, audit_logs   - Google Drive Folder Arsip
    openai/gpt-oss-120b      - Multi-environment ('env')      (Auto PDF upload & link)
```

### Detail Komponen:
1. **Frontend:** Next.js 16 (React 19, TypeScript, Turbopack, Tailwind CSS v4, Lucide Icons, Sonner toast notifications).
2. **Backend API:** FastAPI dengan Uvicorn, arsitektur REST modular tanpa state sesi (stateless).
3. **Database:** PostgreSQL di platform Neon Serverless dengan Threaded Connection Pool yang memiliki mekanisme auto-reconnect saat status serverless suspend/idle.
4. **AI Engine:** Menggunakan Groq Cloud API dengan multi-key load balancing dan failover otomatis untuk menghindari batas kuota gratis (429/TPM).
5. **Google Workspace:** Google Apps Script yang menerima webhook HTTPS POST untuk menulis baris ke Spreadsheet dan mengunggah berkas PDF asli ke folder Google Drive.

---

## 3. Skema Basis Data (Neon PostgreSQL)

### A. Tabel `dokumen`
Menyimpan seluruh metadata hasil ekstraksi dokumen dan tautan berkas arsip.

| Nama Kolom | Tipe Data | Keterangan |
| :--- | :--- | :--- |
| `id` | `INTEGER` (PK) | Auto increment primary key |
| `nama_klien` | `TEXT` | Nama Principal / Perusahaan Terjamin (PT/CV) |
| `jenis_dokumen` | `TEXT` | Nama jaminan (Jaminan Pelaksanaan, Penawaran, dsb.) |
| `kode_jenis` | `TEXT` | Kode singkat (PB, BB, AB, MB, SPPBJ) |
| `nomor_identitas` | `TEXT` | Nomor Jaminan / Nomor Polis / SPPBJ |
| `nilai_proyek` | `TEXT` | Nilai jaminan nominal (contoh: "Rp 1.373.689.860,00") |
| `obligee` | `TEXT` | Nama penerima jaminan / instansi / PPK |
| `pekerjaan` | `TEXT` | Nama paket proyek atau pengadaan |
| `masa_berlaku` | `TEXT` | Teks keterangan rentang waktu (misal: "30 Agt 2026 s/d 30 Des 2026") |
| `tgl_terbit` | `TEXT` | Tanggal penerbitan sertifikat/polis (DD/MM/YYYY) |
| `tgl_awal` | `TEXT` | Tanggal mulai berlaku jaminan (DD/MM/YYYY) |
| `tgl_akhir` | `TEXT` | Tanggal berakhir jaminan (DD/MM/YYYY) |
| `durasi_hk` | `TEXT` | Durasi hari kalender / hari kerja (angka bulat) |
| `teks_dokumen` | `TEXT` | Transkrip teks mentah lengkap hasil pembacaan AI |
| `file_url` | `TEXT` | Tautan file dokumen di Google Drive |
| `file_name` | `TEXT` | Nama file PDF arsip (format: `Nama Principal - Nomor Polis.pdf`) |
| `env` | `TEXT` | Lingkungan data: `'production'` atau `'testing'` |
| `created_at` | `TIMESTAMP` | Waktu pencatatan dokumen (WIB / UTC+7) |
| `updated_at` | `TIMESTAMP` | Waktu terakhir data diubah |

### B. Tabel `audit_logs`
Menyimpan riwayat verifikasi silang, catatan koreksi manual, dan riwayat penghapusan.

| Nama Kolom | Tipe Data | Keterangan |
| :--- | :--- | :--- |
| `id` | `INTEGER` (PK) | Auto increment primary key |
| `doc_id` | `INTEGER` (FK) | Merujuk ke `dokumen.id` |
| `catatan` | `TEXT` | Rincian audit dan catatan persetujuan |
| `created_at` | `TIMESTAMP` | Waktu pencatatan log audit |

---

## 4. Pipeline AI & Logika Ekstraksi

Ekstraksi berjalan melalui alur pipeline bertingkat pada `backend/main.py`:

```
Input File (PDF / Gambar)
         |
         +---> Jika PDF Digital (ada teks): Ekstrak langsung via PyMuPDF
         |
         +---> Jika PDF Scan / Gambar:
                 |
                 +-> Render halaman ke JPEG (DPI 150)
                 +-> Kirim ke Model OCR Vision: `qwen/qwen3.8-27b`
                 +-> Optimasi Cerdas: Jika Halaman 1 memuat data inti surety bond lengkap,
                     proses halaman lampiran dilewati untuk menghemat waktu (~10-15s).
                 +-> Pembersihan teks: Hapus tag <think> & filter perulangan repetitif.
         |
         v
Teks Mentah (Raw Text)
         |
         v
Model Restrukturisasi JSON: `openai/gpt-oss-120b` (Temperature 0.1)
  - Mengekstrak 11 kolom spesifik jaminan.
         |
         v
Targeted Auto-Retry Loop (Hingga 3 kali percobaan):
  - Jika kolom kritis (principal, obligee, nilai_jaminan, pekerjaan, dll.) masih '-',
    kirim prompt bertarget khusus untuk mencari bagian tersebut secara mendalam.
         |
         v
Post-Processing Deterministik Python:
  - Normalisasi format tanggal Indonesia (Maret, Nopember, Pebruari, dll. -> DD/MM/YYYY).
  - Ekstraksi angka Durasi HK via Regex.
  - Regex penangkap Nomor Jaminan / SPPBJ jika model terlewat.
```

---

## 5. Spesifikasi Endpoint Backend API

Base URL: `https://mydata-201q.onrender.com`

### Health Check
* **`GET /` & `GET /health`**
  * Respons: `{"status": "ok", "service": "OCR & Surety API", "timestamp": "..."}`

### Ekstraksi Dokumen
* **`POST /api/extract`**
  * Body: `multipart/form-data` dengan field `file` (PDF, JPG, PNG).
  * Respons: `{"status": "success", "data": { ...data_ekstrak... }}`
  * Fitur: Otomatis mencatat berkas Base64 ke in-memory cache backend untuk pencegahan file hilang saat simpan.

### Operasi Dokumen (CRUD)
* **`GET /api/documents?env={production|testing}`**
  * Mengambil daftar dokumen terurut dari ID terbaru.
* **`POST /api/documents`**
  * Menerima payload JSON dokumen.
  * Menyimpan ke database Neon dan memicu webhook sinkronisasi Google Sheets & Google Drive di latar belakang.
* **`PUT /api/documents/{id}`**
  * Memperbarui metadata dokumen di database Neon dan memperbarui baris terkait di Google Sheets.
* **`DELETE /api/documents/{id}`**
  * Menghapus 1 dokumen dari database Neon dan Google Sheets.
* **`POST /api/documents/bulk-delete`**
  * Body: `{"ids": [1, 2, 3]}`
  * Menghapus banyak dokumen sekaligus dari `audit_logs` dan `dokumen` via query `id = ANY(%s)`.
  * Menghapus baris yang sesuai di Google Sheets secara throttling berurutan.

### Ekspor Berkas Excel
* **`GET /api/documents/export/excel?ids=1,2,3&env={production|testing}`**
  * Mengunduh file `.xlsx` register dokumen. Jika parameter `ids` diberikan, hanya dokumen terpilih yang diekspor.
* **`POST /api/documents/export/batch-excel`**
  * Body: `{"documents": [ ...array_objek_dokumen... ]}`
  * Menghasilkan file Excel khusus untuk antrian dokumen yang baru saja diproses dalam batch unggah tanpa harus mengekspor seluruh riwayat database.

### Audit Log
* **`GET /api/audit-logs`**
  * Mengambil riwayat catatan audit validasi silang.

---

## 6. Antarmuka Pengguna & Fitur Frontend (`frontend/src/app/page.tsx`)

1. **Mode Unggah Tunggal (Single Upload):**
   * Drag-and-drop file atau pilih dari komputer.
   * Indikator waktu proses real-time (detik berjalan).
   * Mode review hasil ekstraksi: kolom dapat langsung diedit sebelum disimpan.
   * Tampilan pratinjau teks OCR asli dengan fitur pencarian kata dan penyorot kuning (`<mark>`).
2. **Mode Unggah Batch (Multi-Dokumen):**
   * Mendukung pemilihan belasan hingga puluhan file PDF/gambar sekaligus.
   * Pemrosesan berurutan dengan jeda aman 2.5 detik antar-dokumen untuk menghindari batas kuota API.
   * Indikator status per dokumen: `pending`, `processing`, `done`, `error`.
   * Tombol "Coba Lagi" individual untuk file yang gagal.
   * Tombol "Hentikan Antrian" dan "Kosongkan Antrian".
   * **Tombol "Unduh Excel Batch (X)":** Mengunduh berkas rekap Excel hanya untuk berkas yang selesai diproses pada batch tersebut. Disertai mekanisme fallback instan sisi klien (format Tab-Separated TSV dengan UTF-8 BOM) jika koneksi jaringan ke server terhambat.
3. **Tabel Data Register Interaktif:**
   * Fitur checkbox baris individu dan checkbox "Pilih Semua" (mendukung status *indeterminate*).
   * Banner status pemilihan di atas tabel yang memunculkan jumlah terpilih dan tombol "Hapus (X) Dokumen".
   * Filter cepat: Pencarian teks bebas, Filter Jenis Dokumen, Filter Status Validasi (Hijau, Kuning, Merah), Filter Bulan, dan Pengurutan (Terbaru/Terlama/Nilai Terbesar).
   * Tombol sinkronisasi manual ("Segarkan Data") yang mengambil data terbaru dari server.
4. **Mesin Validasi Silang (Cross-Validation Engine):**
   * Menguji kecocokan logika:
     * Tanggal Mulai vs Tanggal Berakhir.
     * Perhitungan durasi hari kalender matematis vs angka `durasi_hk` yang tertulis.
     * Format kelengkapan nomor polis dan nominal nilai proyek.
   * Status kartu warna: Hijau (Valid), Kuning (Perlu Konfirmasi), Merah (Anomali).
   * Dukungan *Manual Override* dengan penyimpanan lokal (`localStorage`) dan pencatatan riwayat catatan audit.

---

## 7. Pengaturan Multi-Environment & Alur Git

Sistem memisahkan lingkungan pengujian dan produksi secara tegas melalui variabel `APP_ENV`:

| Parameter | Branch `testing` | Branch `main` |
| :--- | :--- | :--- |
| **Nilai `APP_ENV`** | `"testing"` | `"production"` |
| **Frontend URL** | `https://mydata2-testing.vercel.app` | `https://mydata2.vercel.app` |
| **Backend URL** | `https://mydata-201q.onrender.com` | `https://mydata-201q.onrender.com` |
| **Filter Data DB** | `WHERE env = 'testing'` | `WHERE env = 'production' OR env IS NULL` |
| **Tab Google Sheet** | Sheet: `TESTING` | Sheet: `REGISTER SURETY BOND` |

### Prosedur Perubahan & Deployment:
1. Setiap penambahan fitur atau perbaikan dikerjakan dan diuji terlebih dahulu pada branch `testing`.
2. Push branch `testing` ke GitHub untuk memicu preview deploy di Vercel:
   ```powershell
   git checkout testing
   git add .
   git commit -m "feat/fix: deskripsi perubahan"
   git push origin testing
   ```
3. Setelah diverifikasi di staging, gabungkan ke `main` dengan memastikan nilai `APP_ENV = "production"` pada `frontend/src/app/page.tsx`:
   ```powershell
   git checkout main
   git merge testing
   # Pastikan APP_ENV diatur ke "production"
   git commit -am "chore: deploy production"
   git push origin main
   ```
4. Render secara otomatis memperbarui backend dari branch `main`, dan Vercel memicu deployment produksi.

---

## 8. Konfigurasi Environment Variable

### File `backend/.env`
```env
GROQ_API_KEY=gsk_...,gsk_...
DATABASE_URL=postgresql://neondb_owner:npg_bUlMatF34xGy@ep-purple-hall-az6ep4fv.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/AKfycbyqR2iO8lRtSNnJQWWzUXqHAqSpLYF5w2E5I10E-LPsViQpVUBymdEMRzjG_BnIRcqX8g/exec
```

### File `frontend/.env` dan `frontend/.env.local`
```env
NEXT_PUBLIC_API_URL=https://mydata-201q.onrender.com
```

---

## 9. Panduan Menjalankan Sistem Secara Lokal

### Menjalankan Backend:
```powershell
cd "D:\Firza anti"
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```
Akses Swagger UI: `http://localhost:8000/docs`

### Menjalankan Frontend:
```powershell
cd "D:\Firza anti\frontend"
npm run dev
```
Akses Web Dashboard: `http://localhost:3000`

---

## 10. Status Terkini & Integritas Kode

* **Integritas Kode:** 100% lengkap dan sinkron dengan commit terakhir di GitHub (`4641b61` pada `main` dan `5f42a45` pada `testing`). Tidak ada kode yang hilang.
* **Kompilasi Frontend:** Teruji berhasil melalui `npm run build` tanpa error.
* **Backend & Database:** Berhasil terhubung ke Neon PostgreSQL dan melayani data live (88 dokumen terdaftar).
* **Konfigurasi Lokal:** File `.env` untuk backend dan frontend telah dipulihkan dan siap pakai.
