# PANDUAN PENGUJIAN (TEST SUITE & QA PROTOCOL)

Dokumen ini memuat Standar Operasional Prosedur (SOP) pengujian, regresi kualitas (QA), stress testing, dan verifikasi deployment untuk aplikasi ekstraksi Surety Bond & Bank Garansi.

---

## 1. Prinsip Utama Alur Kerja (Workflow)

1. **Aturan Mutlak Branching**:
   - Seluruh perbaikan bug, refactoring, dan penambahan fitur baru **WAJIB** dikerjakan dan diverifikasi pada branch `testing`.
   - Branch `main` **HANYA** diperbarui melalui merge dari `testing` setelah seluruh rangkaian QA lolos tanpa error.
   - Jangan pernah melakukan perbaikan langsung di branch `main`.

2. **Isolasi Lingkungan (Environment Isolation)**:
   - Nilai variabel `APP_ENV` pada `frontend/src/app/page.tsx`:
     - Branch `testing`: `const APP_ENV: string = "testing";`
     - Branch `main`: `const APP_ENV: string = "production";`
   - Data pengujian tidak boleh mencemari sheet dan basis data produksi. Seluruh payload pengujian harus menyertakan parameter `env: "testing"`.

---

## 2. Checklist Pengujian (QA Checklist)

Sebelum penggabungan ke branch `main`, pastikan 6 fase pengujian berikut terpenuhi:

### Fase 1: Health & Connectivity Check
- [ ] Backend endpoint `/health` merespons dengan status 200 dan status database `ok`.
- [ ] Database Neon terhubung tanpa error pooling.
- [ ] API Key Groq aktif dan kuota tersedia.

### Fase 2: Ekstraksi Dokumen Tunggal & Batch
- [ ] Ekstraksi dokumen tunggal (Single Upload) berjalan normal.
- [ ] Ekstraksi dokumen massal (Batch Upload) memproses antrian tanpa macet (*stuck muter-muter*).
- [ ] Fitur *pre-warming* cold start berjalan sebelum batch pertama dikirim.
- [ ] Mekanisme timeout 75 detik dan auto-retry 1x berfungsi ketika koneksi terputus.
- [ ] Jika terdapat file yang gagal, sistem otomatis melanjutkan ke file berikutnya dalam antrian.

### Fase 3: Uji 17 File Nyata Klien
- [ ] Menjalankan stress test menggunakan 17 berkas asli klien pada direktori:
  `C:\Users\Dzaky Rayssa Buntoro\Pictures\firza trial`
- [ ] Memastikan seluruh 17 file dapat diekstrak teksnya dan menghasilkan field terstruktur:
  - Nomor Jaminan / Polis
  - Principal
  - Obligee
  - Nilai Proyek / Jaminan
  - Pekerjaan
  - Tanggal Awal, Akhir, Terbit
  - Durasi Hari Kerja (HK)
- [ ] Rata-rata durasi ekstraksi berada di bawah 15 detik per dokumen.

### Fase 4: Integrasi Database & Google Spreadsheet
- [ ] Data berhasil tersimpan ke tabel `dokumen` di Neon PostgreSQL dengan kolom `env` sesuai target.
- [ ] Verifikasi pemisahan data: pemanggilan `GET /api/documents?env=testing` hanya memuat data pengujian dan tidak mencemari data `env=production`.
- [ ] Sinkronisasi Webhook Google Apps Script berjalan (data masuk ke baris sheet yang benar).

### Fase 5: Ekspor Rekap Excel & Manajemen Data
- [ ] Endpoint `POST /api/documents/export/batch-excel` menghasilkan file `.xlsx` valid dengan format tabel register asuransi.
- [ ] Endpoint `POST /api/documents/bulk-delete` dapat menghapus data pengujian secara massal.

### Fase 6: Verifikasi Build Frontend
- [ ] Menjalankan `npm run build` di dalam folder `frontend/` dengan Turbopack/Next.js.
- [ ] Hasil build harus exit code 0 tanpa peringatan TypeScript atau syntax error.

---

## 3. Eksekusi Script Otomatis (QA Suite)

Untuk menjalankan seluruh rangkaian pengujian di atas secara otomatis, jalankan script `qa_suite.py`:

```bash
# Menjalankan pengujian untuk environment testing
python qa_suite.py --env testing

# Menjalankan pengujian untuk environment production (verifikasi pasca-deploy)
python qa_suite.py --env production
```

Script akan memvalidasi:
1. Health check backend
2. Ekstraksi batch 17 file klien
3. Validasi skema dan kelengkapan field
4. Penyimpanan ke database
5. Ekspor batch Excel
6. Pembersihan data pengujian (cleanup)

---

## 4. Prosedur Rilis ke Production

Setelah seluruh checklist pada branch `testing` lolos:

1. **Pindah ke Branch Main**:
   ```bash
   git checkout main
   git merge testing
   ```

2. **Set APP_ENV ke Production**:
   Pastikan baris ke-16 pada `frontend/src/app/page.tsx` bernilai:
   ```typescript
   const APP_ENV: string = "production";
   ```

3. **Verifikasi Build Lokal**:
   ```bash
   cd frontend
   npm run build
   cd ..
   ```

4. **Commit & Push ke Production**:
   ```bash
   git commit -am "chore(prod): release batch resilience and speed optimizations to production"
   git push origin main
   ```

5. **Verifikasi Pasca-Deploy**:
   - Buka URL Production: https://mydata2.vercel.app
   - Pastikan badge di pojok kiri atas menunjukkan mode Production (bukan label Testing merah).
   - Jalankan smoke test 1 dokumen melalui antarmuka produksi.
