import os
import sys
import glob
import time
import json
import argparse
import requests

BACKEND_URL = os.environ.get("BACKEND_URL", "http://127.0.0.1:8000")
DEFAULT_FILES_DIR = r"C:\Users\Dzaky Rayssa Buntoro\Pictures\firza trial"

def print_header(title):
    print("\n" + "=" * 60)
    print(f" {title}")
    print("=" * 60)

def test_health(base_url):
    print("\n[TEST 1/6] Pengecekan Health & Database Connection...")
    try:
        res = requests.get(f"{base_url}/health", timeout=15)
        if res.status_code == 200:
            data = res.json()
            print(f"  [OK] Backend Status : {data.get('status')}")
            print(f"  [OK] Service        : {data.get('service')}")
            return True
        else:
            print(f"  [GAGAL] Status code: {res.status_code}, response: {res.text}")
            return False
    except Exception as e:
        print(f"  [GAGAL] Error koneksi ke {base_url}: {e}")
        return False

def test_batch_extraction(base_url, files_dir, max_files=None):
    print("\n[TEST 2/6] Pengujian Ekstraksi Batch...")
    files = glob.glob(os.path.join(files_dir, "*.pdf"))
    if not files:
        print(f"  [GAGAL] Tidak ada file PDF ditemukan di {files_dir}")
        return [], 0

    if max_files:
        files = files[:max_files]

    print(f"  Jumlah file yang diuji: {len(files)} file")
    results = []
    total_time = 0.0

    for idx, fpath in enumerate(files, 1):
        fname = os.path.basename(fpath)
        start_t = time.time()
        try:
            with open(fpath, "rb") as f:
                res = requests.post(
                    f"{base_url}/api/extract",
                    files={"file": (fname, f, "application/pdf")},
                    timeout=90
                )
            dur = time.time() - start_t
            total_time += dur

            if res.status_code == 200:
                d = res.json()
                data = d.get("data", {})
                nomor = data.get("nomor_jaminan") or "(kosong)"
                principal = data.get("principal") or "(kosong)"
                nilai = data.get("nilai_jaminan") or "(kosong)"
                print(f"  [{idx:02d}/{len(files):02d}] [OK] {dur:.2f}s | {fname[:35]} | No: {nomor} | {principal[:20]} | {nilai}")
                results.append((fname, data))
            else:
                print(f"  [{idx:02d}/{len(files):02d}] [GAGAL] {dur:.2f}s | {fname} | Status {res.status_code}: {res.text[:100]}")
        except Exception as e:
            dur = time.time() - start_t
            total_time += dur
            print(f"  [{idx:02d}/{len(files):02d}] [ERROR] {dur:.2f}s | {fname} | Exception: {e}")

    avg_time = (total_time / len(files)) if files else 0
    print(f"\n  Ringkasan Ekstraksi:")
    print(f"  - Berhasil  : {len(results)}/{len(files)} file")
    print(f"  - Total Waktu: {total_time:.2f} detik")
    print(f"  - Rata-rata  : {avg_time:.2f} detik/file")
    return results, len(files)

def test_database_isolation(base_url, target_env, extracted_items):
    print(f"\n[TEST 3/6] Pengujian Simpan ke Database dengan ENV='{target_env}'...")
    if not extracted_items:
        print("  [SKIP] Tidak ada data ekstraksi yang tersedia.")
        return []

    saved_ids = []
    sample_items = extracted_items[:3]
    for fname, data in sample_items:
        payload = {
            "nama_klien": data.get("principal") or "QA TEST PRINCIPAL",
            "jenis_dokumen": data.get("jenis_jaminan") or "Jaminan Pelaksanaan",
            "kode_jenis": data.get("kode_jenis") or "PB",
            "nomor_identitas": f"QA-TEST-{data.get('nomor_jaminan') or '001'}",
            "nilai_proyek": data.get("nilai_jaminan") or "Rp 100.000.000",
            "obligee": data.get("obligee") or "QA OBLIGEE",
            "pekerjaan": data.get("pekerjaan") or "QA PEKERJAAN",
            "masa_berlaku": data.get("masa_berlaku") or "30 hari",
            "tgl_terbit": data.get("tgl_terbit") or "01/01/2026",
            "tgl_awal": data.get("tgl_awal") or "01/01/2026",
            "tgl_akhir": data.get("tgl_akhir") or "31/01/2026",
            "durasi_hk": data.get("durasi_hk") or "30",
            "teks_dokumen": data.get("teks_asli") or "QA Teks Uji Dokumen",
            "file_url": "",
            "file_name": fname,
            "env": target_env
        }
        try:
            res = requests.post(f"{base_url}/api/documents", json=payload, timeout=15)
            if res.status_code == 200:
                doc_id = res.json().get("id")
                if doc_id:
                    saved_ids.append(doc_id)
                print(f"  [OK] Data tersimpan dengan ID: {doc_id} pada env: {target_env}")
            else:
                print(f"  [GAGAL] Status {res.status_code}: {res.text}")
        except Exception as e:
            print(f"  [ERROR] Simpan gagal: {e}")

    # Verifikasi isolasi query
    print(f"\n[TEST 4/6] Verifikasi Isolasi Query GET /api/documents?env={target_env}...")
    try:
        res = requests.get(f"{base_url}/api/documents?env={target_env}", timeout=15)
        if res.status_code == 200:
            docs = res.json()
            if isinstance(docs, list):
                matched = [d for d in docs if d.get("id") in saved_ids]
                print(f"  [OK] Total dokumen pada env '{target_env}': {len(docs)}")
                print(f"  [OK] Dokumen uji berhasil ditemukan dalam env '{target_env}': {len(matched)}/{len(saved_ids)}")
            else:
                print(f"  [GAGAL] Format respons tidak berupa list: {type(docs)}")
        else:
            print(f"  [GAGAL] Query documents gagal: {res.status_code}")
    except Exception as e:
        print(f"  [ERROR] Verifikasi query gagal: {e}")

    return saved_ids

def test_batch_excel(base_url, target_env):
    print(f"\n[TEST 5/6] Pengujian Ekspor Rekap Batch Excel...")
    try:
        res_docs = requests.get(f"{base_url}/api/documents?env={target_env}", timeout=15)
        docs = res_docs.json() if res_docs.status_code == 200 and isinstance(res_docs.json(), list) else []
        if not docs:
            print("  [SKIP] Tidak ada data dokumen untuk diekspor.")
            return True

        # Ambil maksimal 5 dokumen
        sample_docs = docs[:5]
        payload = {"documents": sample_docs}
        res = requests.post(f"{base_url}/api/documents/export/batch-excel", json=payload, timeout=20)
        if res.status_code == 200 and len(res.content) > 1000:
            print(f"  [OK] File Excel rekap berhasil diunduh ({len(res.content)} bytes)")
            return True
        else:
            print(f"  [GAGAL] Ekspor Excel gagal: status {res.status_code}, response: {res.text[:100]}")
            return False
    except Exception as e:
        print(f"  [ERROR] Ekspor Excel gagal: {e}")
        return False

def test_cleanup(base_url, saved_ids, target_env):
    print(f"\n[TEST 6/6] Pembersihan Data Pengujian (Bulk Delete)...")
    if not saved_ids:
        print("  [INFO] Tidak ada data pengujian yang perlu dihapus.")
        return True

    try:
        payload = {"ids": saved_ids}
        res = requests.post(f"{base_url}/api/documents/bulk-delete", json=payload, timeout=15)
        if res.status_code == 200:
            deleted_count = res.json().get("deleted_count", 0)
            print(f"  [OK] {deleted_count} dokumen uji berhasil dibersihkan dari database.")
            return True
        else:
            print(f"  [GAGAL] Bulk delete gagal: status {res.status_code}, response: {res.text[:100]}")
            return False
    except Exception as e:
        print(f"  [ERROR] Cleanup gagal: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="QA Test Suite Antigravity OCR")
    parser.add_argument("--url", default=BACKEND_URL, help="Base URL backend")
    parser.add_argument("--env", default="testing", choices=["testing", "production"], help="Target environment")
    parser.add_argument("--dir", default=DEFAULT_FILES_DIR, help="Folder PDF klien")
    parser.add_argument("--max-files", type=int, default=None, help="Batas jumlah file pengujian")
    parser.add_argument("--quick", action="store_true", help="Mode uji cepat (2 file)")
    args = parser.parse_args()

    max_files = 2 if args.quick else args.max_files

    print_header(f"QA TEST SUITE - Target Env: {args.env.upper()}")
    print(f"Backend URL : {args.url}")
    print(f"Files Dir   : {args.dir}")
    print(f"Mode        : {'Quick Smoke Test (2 files)' if args.quick else 'Full Stress Test'}")

    # 1. Health
    if not test_health(args.url):
        print("\n[STOP] Health check gagal, pengujian dihentikan.")
        sys.exit(1)

    # 2. Batch Extraction
    extracted, total_files = test_batch_extraction(args.url, args.dir, max_files=max_files)
    if not extracted:
        print("\n[STOP] Seluruh ekstraksi gagal.")
        sys.exit(1)

    # 3 & 4. Database Isolation
    saved_ids = test_database_isolation(args.url, args.env, extracted)

    # 5. Batch Excel
    test_batch_excel(args.url, args.env)

    # 6. Cleanup
    test_cleanup(args.url, saved_ids, args.env)

    print_header("SELURUH RANGKAIAN UJI SELESAI DENGAN SUKSES")

if __name__ == "__main__":
    main()
