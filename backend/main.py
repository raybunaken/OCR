import os
import io
import re
import json
import base64
import fitz
import datetime
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import psycopg2
import psycopg2.extras
from groq import Groq
from dotenv import load_dotenv
from contextlib import asynccontextmanager

load_dotenv()

GROQ_API_KEYS = [k.strip() for k in os.getenv("GROQ_API_KEY", "").split(",") if k.strip()]
groq_clients = [Groq(api_key=k) for k in GROQ_API_KEYS]

def call_groq_api(**kwargs):
    if not groq_clients:
        raise Exception("Tidak ada GROQ_API_KEY yang dikonfigurasi.")
        
    last_exception = None
    for i, client in enumerate(groq_clients):
        try:
            return client.chat.completions.create(**kwargs)
        except Exception as e:
            last_exception = e
            error_str = str(e).lower()
            if "429" in error_str or "rate limit" in error_str or "rate_limit" in error_str or "413" in error_str:
                print(f"Fallback (Key {i+1} Limit): Mencoba kunci berikutnya... Error: {e}")
                continue
            break
            
    raise last_exception

# Ambil URL Database PostgreSQL (Neon) dari environment variable
DATABASE_URL = os.getenv("DATABASE_URL")

def init_db():
    if not DATABASE_URL:
        print("WARNING: DATABASE_URL belum diatur!")
        return
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()
    
    # Buat tabel dokumen jika belum ada
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS dokumen (
            id SERIAL PRIMARY KEY,
            nama_klien TEXT,
            jenis_dokumen TEXT,
            nomor_identitas TEXT,
            nilai_proyek TEXT,
            obligee TEXT,
            pekerjaan TEXT,
            masa_berlaku TEXT,
            teks_dokumen TEXT,
            created_at TIMESTAMP,
            updated_at TIMESTAMP
        )
    """)
    
    # Buat tabel audit_logs jika belum ada
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            doc_id INTEGER,
            catatan TEXT,
            created_at TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Inisialisasi Database Tables
    init_db()
    yield
    # Shutdown

app = FastAPI(title="Insurance CRM API", lifespan=lifespan)

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class DocumentUpdate(BaseModel):
    nama_klien: str
    jenis_dokumen: str
    nomor_identitas: str
    nilai_proyek: str
    obligee: str
    pekerjaan: str
    masa_berlaku: str
    teks_dokumen: str

def get_db_connection():
    if not DATABASE_URL:
        raise HTTPException(status_code=500, detail="Database URL belum dikonfigurasi")
    conn = psycopg2.connect(DATABASE_URL)
    return conn

def encode_image_bytes(image_bytes):
    return base64.b64encode(image_bytes).decode('utf-8')

def parse_robust_json(content, fallback_data):
    if not content:
        return fallback_data
    # 1. Clean markdown & think tags
    clean = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL)
    if "```json" in clean:
        clean = clean.split("```json")[1].split("```")[0]
    elif "```" in clean:
        clean = clean.split("```")[1].split("```")[0]
        
    start_idx = clean.find('{')
    end_idx = clean.rfind('}')
    
    if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
        json_candidate = clean[start_idx:end_idx+1]
        try:
            parsed = json.loads(json_candidate.strip())
            for k in fallback_data:
                if k in parsed and parsed[k]:
                    fallback_data[k] = parsed[k]
            return fallback_data
        except Exception:
            pass
            
    # 2. Regex field extractor if JSON was truncated or malformed
    keys = ["jenis_jaminan", "nomor_jaminan", "nilai_jaminan", "principal", "obligee", "pekerjaan", "masa_berlaku", "teks_asli"]
    for k in keys:
        match = re.search(rf'"{k}"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"', clean, re.DOTALL)
        if match:
            fallback_data[k] = match.group(1).replace('\\"', '"')
            
    if not fallback_data["teks_asli"] or fallback_data["teks_asli"] == "-":
        fallback_data["teks_asli"] = clean.strip()
        
    return fallback_data

def rapikan_teks(teks_mentah):
    fallback_data = {
        "jenis_jaminan": "-", "nomor_jaminan": "-", "nilai_jaminan": "-", 
        "principal": "-", "obligee": "-", "pekerjaan": "-", 
        "masa_berlaku": "-", "teks_asli": teks_mentah
    }
    if len(teks_mentah.strip()) < 20: return fallback_data
    
    if not groq_clients:
        fallback_data["teks_asli"] = "WARNING: GROQ_API_KEY belum dikonfigurasi di .env Server!\n\n" + teks_mentah
        return fallback_data
        
    base_prompt = (
        "Anda adalah asisten AI ahli administrasi asuransi Surety Bond & Bank Garansi Indonesia.\n"
        "Tugas Anda mengekstrak informasi penting dari teks dokumen menjadi format JSON murni.\n\n"
        "PANDUAN EKSTRAKSI DOMAIN:\n"
        "- principal: Nama Perusahaan/Badan Hukum Pemohon/Terjamin/Penyedia/Kontraktor (contoh: CV. ..., PT. ...)\n"
        "- obligee: Nama Penerima Jaminan/Pemilik Proyek/Pemilik Pekerjaan/Pejabat Pembuat Komitmen (PPK)/Dinas/Kementerian/BUMN/Perusahaan Pemberi Kerja\n"
        "- jenis_jaminan: Jenis jaminan (Jaminan Pelaksanaan, Jaminan Uang Muka, Jaminan Penawaran, Jaminan Pemeliharaan, Surety Bond, dll)\n"
        "- nilai_jaminan: Nilai nominal jaminan atau nilai proyek (sertakan 'Rp' dan angka lengkap)\n"
        "- nomor_jaminan: Nomor identitas jaminan / nomor surat / nomor permohonan / SPPBJ / register\n"
        "- pekerjaan: Nama kegiatan / pengadaan / paket proyek pekerjaan\n"
        "- masa_berlaku: Jangka waktu jaminan / jumlah hari kalender (HK) / rentang tanggal berlaku (contoh: 120 HK atau tanggal s/d tanggal)\n"
        "- teks_asli: Rapikan teks OCR dengan jarak baris/enter baru untuk tiap poin penomoran atau pergantian data\n\n"
        "Format respons HANYA JSON:\n"
        "{\n"
        '  "jenis_jaminan": "...",\n'
        '  "nomor_jaminan": "...",\n'
        '  "nilai_jaminan": "...",\n'
        '  "principal": "...",\n'
        '  "obligee": "...",\n'
        '  "pekerjaan": "...",\n'
        '  "masa_berlaku": "...",\n'
        '  "teks_asli": "..."\n'
        "}\n"
        "Jangan gunakan tag <think>. Jika kolom benar-benar tidak ada di teks, isi '-'.\n\n"
        "Teks OCR Dokumen:\n" + teks_mentah
    )
    
    result_data = dict(fallback_data)
    try:
        chat = call_groq_api(
            messages=[{"role": "user", "content": base_prompt}],
            model="openai/gpt-oss-120b",
            temperature=0.1,
            max_tokens=4000
        )
        result_data = parse_robust_json(chat.choices[0].message.content, result_data)
    except Exception as e:
        print("ERROR AI EXTRACTION ATTEMPT 1:", e)
        
    # Auto-Retry Loop jika ada kolom penting yang masih '-' (Maksimal 3 kali percobaan bertarget)
    critical_keys = ["principal", "obligee", "nilai_jaminan", "pekerjaan", "masa_berlaku", "jenis_jaminan"]
    max_retries = 3
    for attempt in range(2, max_retries + 1):
        missing_keys = [k for k in critical_keys if not result_data.get(k) or result_data[k] == "-"]
        if not missing_keys:
            break
            
        print(f"AUTO-RETRY {attempt}/{max_retries} for missing keys: {missing_keys}")
        retry_prompt = (
            f"PERHATIAN: Kolom penting berikut belum ditemukan pada pembacaan awal: {', '.join(missing_keys)}.\n"
            "Mohon teliti kembali teks dokumen di bawah ini secara mendalam baris demi baris.\n"
            "Petunjuk Khusus:\n"
            "- Jika 'obligee' belum ada: cari bagian PENERIMA JAMINAN, PEMILIK PROYEK, PEJABAT PEMBUAT KOMITMEN (PPK), DINAS, INSTANSI, atau PERUSAHAAN PEMBERI KERJA.\n"
            "- Jika 'principal' belum ada: cari bagian PEMOHON, TERJAMIN, PENYEDIA JASA, NAMA PERUSAHAAN (PT/CV).\n"
            "- Jika 'nilai_jaminan' belum ada: cari simbol 'Rp', nilai jaminan %, atau nominal angka kontrak.\n"
            "- Jika 'pekerjaan' belum ada: cari nama paket pekerjaan, pengadaan barang/jasa, atau pembangunan.\n\n"
            "Berikan respons JSON HANYA untuk kolom-kolom yang masih kosong tersebut:\n"
            "{\n" + ",\n".join([f'  "{k}": "..."' for k in missing_keys]) + "\n}\n"
            "Teks Dokumen:\n" + teks_mentah
        )
        try:
            chat_retry = call_groq_api(
                messages=[{"role": "user", "content": retry_prompt}],
                model="openai/gpt-oss-120b",
                temperature=0.2,
                max_tokens=2000
            )
            retry_parsed = parse_robust_json(chat_retry.choices[0].message.content, {})
            for k in missing_keys:
                if retry_parsed.get(k) and retry_parsed[k] != "-":
                    result_data[k] = retry_parsed[k]
        except Exception as err:
            print(f"ERROR ON AUTO-RETRY {attempt}:", err)
            
    return result_data


def extract_from_image_vision(base64_image):
    """Mengekstrak teks dari gambar dengan Groq Vision lalu menstrukturkannya dengan GPT-120B"""
    fallback_data = {
        "jenis_jaminan": "-", "nomor_jaminan": "-", "nilai_jaminan": "-", 
        "principal": "-", "obligee": "-", "pekerjaan": "-", 
        "masa_berlaku": "-", "teks_asli": ""
    }
    if not groq_clients:
        return fallback_data
        
    try:
        # Step 1: Gunakan Qwen Vision sebagai mesin OCR murni
        ocr_prompt = "Lakukan OCR pada gambar dokumen Surety Bond ini. Transkripsikan semua teks yang terlihat pada gambar secara lengkap, jelas, dan akurat."
        chat = call_groq_api(
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": ocr_prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                    ]
                }
            ],
            model="qwen/qwen3.6-27b",
            temperature=0.1,
            max_tokens=3000
        )
        raw_content = chat.choices[0].message.content
        
        # Bersihkan tag <think> jika ada
        clean_text = re.sub(r"<think>.*?</think>", "", raw_content, flags=re.DOTALL).strip()
        if not clean_text:
            clean_text = raw_content.replace("<think>", "").replace("</think>", "").strip()
            
        if len(clean_text) < 15:
            fallback_data["teks_asli"] = "Tidak ada teks yang dapat dibaca dari gambar."
            return fallback_data
            
        # Step 2: Kirim teks OCR ke GPT-120B untuk ekstraksi JSON rapi
        return rapikan_teks(clean_text)
        
    except Exception as e:
        print("ERROR GROQ VISION:", e)
        fallback_data["teks_asli"] = "Pengekstrakan gagal: " + str(e)
        return fallback_data


@app.post("/api/extract")
async def extract_document(file: UploadFile = File(...)):
    contents = await file.read()
    
    try:
        if file.filename.lower().endswith('.pdf'):
            doc = fitz.open("pdf", contents)
            teks_digital = ""
            for page in doc:
                teks_digital += page.get_text().strip() + "\n"
                
            if len(teks_digital.strip()) > 50:
                # Digital PDF (bisa di-select teksnya)
                data_ekstrak = rapikan_teks(teks_digital)
                return {"status": "success", "data": data_ekstrak}
            else:
                # PDF Scan (hanya berisi gambar) -> Render halaman 1 ke gambar
                page = doc[0]
                pix = page.get_pixmap(dpi=150)
                img_bytes = pix.tobytes("jpeg")
                b64_image = encode_image_bytes(img_bytes)
                data_ekstrak = extract_from_image_vision(b64_image)
                return {"status": "success", "data": data_ekstrak}
                
        elif file.filename.lower().endswith(('.jpg', '.jpeg', '.png')):
            # Langsung kirim ke Groq Vision
            b64_image = encode_image_bytes(contents)
            data_ekstrak = extract_from_image_vision(b64_image)
            return {"status": "success", "data": data_ekstrak}
        else:
            raise HTTPException(status_code=400, detail="Format tidak didukung. Harap upload PDF, JPG, atau PNG.")
            
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/documents")
def get_documents():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cursor.execute("SELECT * FROM dokumen ORDER BY id DESC")
    docs = cursor.fetchall()
    conn.close()
    return [dict(ix) for ix in docs]

@app.post("/api/documents")
def save_document(doc: DocumentUpdate):
    waktu_sekarang = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO dokumen (nama_klien, jenis_dokumen, nomor_identitas, nilai_proyek, obligee, pekerjaan, masa_berlaku, teks_dokumen, created_at, updated_at) 
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (doc.nama_klien, doc.jenis_dokumen, doc.nomor_identitas, doc.nilai_proyek, doc.obligee, doc.pekerjaan, doc.masa_berlaku, doc.teks_dokumen, waktu_sekarang, waktu_sekarang))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: int):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM audit_logs WHERE doc_id=%s", (doc_id,))
        cursor.execute("DELETE FROM dokumen WHERE id=%s", (doc_id,))
        conn.commit()
        conn.close()
        return {"status": "success"}
    except Exception as e:
        print("ERROR DELETE:", e)
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/documents/{doc_id}")
def update_document(doc_id: int, doc: DocumentUpdate):
    waktu_sekarang = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    
    # 1. Ambil data lama
    cursor.execute("SELECT * FROM dokumen WHERE id=%s", (doc_id,))
    old_data = cursor.fetchone()
    if not old_data:
        conn.close()
        raise HTTPException(status_code=404, detail="Dokumen tidak ditemukan")
        
    old_data_dict = dict(old_data)
    
    # 2. Bandingkan data untuk mencari perubahan
    perubahan = []
    field_map = {
        "nama_klien": ("Nama Klien", doc.nama_klien),
        "jenis_dokumen": ("Jenis Jaminan", doc.jenis_dokumen),
        "nomor_identitas": ("Nomor Jaminan", doc.nomor_identitas),
        "nilai_proyek": ("Nilai Jaminan", doc.nilai_proyek),
        "obligee": ("Obligee", doc.obligee),
        "pekerjaan": ("Pekerjaan", doc.pekerjaan),
        "masa_berlaku": ("Masa Berlaku", doc.masa_berlaku)
    }
    
    for key, (label, new_val) in field_map.items():
        old_val = old_data_dict.get(key)
        if str(old_val).strip() != str(new_val).strip():
            perubahan.append(f"{label} diubah dari '{old_val}' menjadi '{new_val}'")
            
    # Track Teks Asli
    if str(old_data_dict.get("teks_dokumen")).strip() != str(doc.teks_dokumen).strip():
        perubahan.append("Teks Asli Dokumen telah diubah / diedit secara manual")
            
    # 3. Jika ada perubahan, catat ke audit_logs
    if perubahan:
        catatan_lengkap = " | ".join(perubahan)
        cursor.execute("INSERT INTO audit_logs (doc_id, catatan, created_at) VALUES (%s, %s, %s)", (doc_id, catatan_lengkap, waktu_sekarang))
    
    # 4. Update tabel dokumen
    cursor.execute("""
        UPDATE dokumen 
        SET nama_klien=%s, jenis_dokumen=%s, nomor_identitas=%s, nilai_proyek=%s, obligee=%s, pekerjaan=%s, masa_berlaku=%s, teks_dokumen=%s, updated_at=%s
        WHERE id=%s
    """, (doc.nama_klien, doc.jenis_dokumen, doc.nomor_identitas, doc.nilai_proyek, doc.obligee, doc.pekerjaan, doc.masa_berlaku, doc.teks_dokumen, waktu_sekarang, doc_id))
    
    conn.commit()
    conn.close()
    return {"status": "success", "perubahan_dicatat": len(perubahan) > 0}

@app.get("/api/documents/{doc_id}/logs")
def get_audit_logs(doc_id: int):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cursor.execute("SELECT * FROM audit_logs WHERE doc_id=%s ORDER BY id DESC", (doc_id,))
    logs = cursor.fetchall()
    conn.close()
    
    # Convert datetime objects to string if psycopg2 returns datetime
    result = []
    for log in logs:
        log_dict = dict(log)
        if isinstance(log_dict['created_at'], datetime.datetime):
             log_dict['created_at'] = log_dict['created_at'].strftime("%Y-%m-%d %H:%M:%S")
        result.append(log_dict)
    return result
