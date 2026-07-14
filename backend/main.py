from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3
import json
import fitz
import numpy as np
from PIL import Image
from groq import Groq
from paddleocr import PaddleOCR
import datetime
import os
import io

import asyncio
import shutil
import time
from contextlib import asynccontextmanager

# Pastikan path absolut agar tidak error saat dihosting via gunicorn/systemd
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Setup Auto Backup Loop
BACKUP_DIR = os.path.join(BASE_DIR, "backups")
os.makedirs(BACKUP_DIR, exist_ok=True)

async def auto_backup_loop():
    while True:
        try:
            # Karena ini initial test, saya setel sleep-nya di akhir agar backup pertama langsung berjalan saat server menyala
            timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            backup_filename = f"backup_arsip_{timestamp}.db"
            
            # DB_PATH akan di-define di bawah, tapi kita bisa pakai variabel global
            target_db = os.getenv("DB_PATH", os.path.abspath(os.path.join(BASE_DIR, "..", "arsip_asuransi.db")))
            backup_path = os.path.join(BACKUP_DIR, backup_filename)
            
            if os.path.exists(target_db):
                shutil.copy2(target_db, backup_path)
                print(f"✅ AUTO-BACKUP BERHASIL: {backup_filename}")
                
            # Cleanup old backups (> 7 hari)
            now = time.time()
            for filename in os.listdir(BACKUP_DIR):
                filepath = os.path.join(BACKUP_DIR, filename)
                if os.path.isfile(filepath):
                    if os.stat(filepath).st_mtime < now - 7 * 86400:
                        os.remove(filepath)
                        print(f"🗑️ BACKUP LAMA DIHAPUS: {filename}")
                        
        except Exception as e:
            print(f"❌ ERROR AUTO-BACKUP: {e}")
            
        await asyncio.sleep(86400) # Tunggu 24 Jam

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    task = asyncio.create_task(auto_backup_loop())
    yield
    # Shutdown
    task.cancel()

app = FastAPI(title="Insurance CRM API", lifespan=lifespan)
# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from dotenv import load_dotenv
import cv2

load_dotenv()

# Initialize OCR and AI
ocr = PaddleOCR(use_angle_cls=True, lang='id', enable_mkldnn=False)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

DB_PATH = os.getenv("DB_PATH", os.path.abspath(os.path.join(BASE_DIR, "..", "arsip_asuransi.db")))

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
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=15.0)
    conn.row_factory = sqlite3.Row
    return conn

def rapikan_teks(teks_mentah):
    fallback_data = {
        "jenis_jaminan": "-", "nomor_jaminan": "-", "nilai_jaminan": "-", 
        "principal": "-", "obligee": "-", "pekerjaan": "-", 
        "masa_berlaku": "-", "teks_asli": teks_mentah
    }
    if len(teks_mentah.strip()) < 20: return fallback_data
    
    if not groq_client:
        fallback_data["teks_asli"] = "WARNING: GROQ_API_KEY belum dikonfigurasi di .env Server!\n\n" + teks_mentah
        return fallback_data
        
    try:
        prompt = (
            "Anda adalah asisten admin asuransi. Tugas Anda adalah mengekstrak teks hasil OCR menjadi format JSON.\n"
            "Ekstrak informasi penting dari dokumen Surety Bond dan berikan respons HANYA berupa JSON murni dengan struktur berikut:\n"
            "{\n"
            '  "jenis_jaminan": "... (contoh: Jaminan Pelaksanaan, Jaminan Uang Muka, dll)",\n'
            '  "nomor_jaminan": "... (nomor Bond/Jaminan)",\n'
            '  "nilai_jaminan": "... (nilai uang)",\n'
            '  "principal": "... (Nama Terjamin/Penyedia)",\n'
            '  "obligee": "... (Penerima Jaminan/Pemilik Pekerjaan)",\n'
            '  "pekerjaan": "... (Nama Pekerjaan/Proyek)",\n'
            '  "masa_berlaku": "... (Jangka waktu/Tanggal berlaku)",\n'
            '  "teks_asli": "... (Rapikan teks OCR. Beri jarak baris/enter baru untuk setiap pergantian informasi atau poin penomoran (1, 2, 3). JANGAN gabungkan semuanya menjadi satu blok paragraf panjang.)"\n'
            "}\n"
            "Jika ada data yang tidak ditemukan, isi dengan '-'.\n"
            "Teks OCR:\n" + teks_mentah
        )
        chat = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant",
            temperature=0.2
        )
        content = chat.choices[0].message.content
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
        return json.loads(content.strip())
    except Exception as e:
        print("ERROR AI EXTRACTION:", e)
        return fallback_data

@app.post("/api/extract")
async def extract_document(file: UploadFile = File(...)):
    contents = await file.read()
    full_text = ""
    
    try:
        if file.filename.lower().endswith('.pdf'):
            doc = fitz.open("pdf", contents)
            for page in doc:
                pix = page.get_pixmap(alpha=False, colorspace=fitz.csRGB)
                img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
                
                teks_digital = page.get_text().strip()
                if len(teks_digital) > 20:
                    full_text += teks_digital + "\n"
                else:
                    result = ocr.ocr(img)
                    if result:
                        for res in result:
                            if not res: continue
                            for line in res:
                                if isinstance(line, (list, tuple)) and len(line) >= 2:
                                    full_text += line[1][0] + " "
                    full_text += "\n"
        elif file.filename.lower().endswith(('.jpg', '.jpeg', '.png')):
            img_array = np.frombuffer(contents, np.uint8)
            img_cv2 = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
            result = ocr.ocr(img_cv2)
            if result:
                for res in result:
                    if not res: continue
                    if isinstance(res, dict) and 'rec_texts' in res:
                        # Versi PaddleOCR (PaddleX backend) terbaru
                        for text in res['rec_texts']:
                            if text: full_text += str(text) + "\n"
                    elif isinstance(res, list):
                        # Versi standar/lama PaddleOCR
                        for line in res:
                            if isinstance(line, (list, tuple)) and len(line) >= 2:
                                full_text += str(line[1][0]) + "\n"
            full_text += "\n"
        else:
            raise HTTPException(status_code=400, detail="Format tidak didukung. Harap upload PDF, JPG, atau PNG.")
            
        data_ekstrak = rapikan_teks(full_text)
        return {"status": "success", "data": data_ekstrak}
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/documents")
def get_documents():
    conn = get_db_connection()
    docs = conn.execute("SELECT * FROM dokumen ORDER BY id DESC").fetchall()
    conn.close()
    return [dict(ix) for ix in docs]

@app.post("/api/documents")
def save_document(doc: DocumentUpdate):
    waktu_sekarang = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO dokumen (nama_klien, jenis_dokumen, nomor_identitas, nilai_proyek, obligee, pekerjaan, masa_berlaku, teks_dokumen, created_at, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (doc.nama_klien, doc.jenis_dokumen, doc.nomor_identitas, doc.nilai_proyek, doc.obligee, doc.pekerjaan, doc.masa_berlaku, doc.teks_dokumen, waktu_sekarang, waktu_sekarang))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM dokumen WHERE id=?", (doc_id,))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.put("/api/documents/{doc_id}")
def update_document(doc_id: int, doc: DocumentUpdate):
    waktu_sekarang = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Ambil data lama
    old_data = cursor.execute("SELECT * FROM dokumen WHERE id=?", (doc_id,)).fetchone()
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
        cursor.execute("INSERT INTO audit_logs (doc_id, catatan, created_at) VALUES (?, ?, ?)", (doc_id, catatan_lengkap, waktu_sekarang))
    
    # 4. Update tabel dokumen
    cursor.execute("""
        UPDATE dokumen 
        SET nama_klien=?, jenis_dokumen=?, nomor_identitas=?, nilai_proyek=?, obligee=?, pekerjaan=?, masa_berlaku=?, teks_dokumen=?, updated_at=?
        WHERE id=?
    """, (doc.nama_klien, doc.jenis_dokumen, doc.nomor_identitas, doc.nilai_proyek, doc.obligee, doc.pekerjaan, doc.masa_berlaku, doc.teks_dokumen, waktu_sekarang, doc_id))
    
    conn.commit()
    conn.close()
    return {"status": "success", "perubahan_dicatat": len(perubahan) > 0}

@app.get("/api/documents/{doc_id}/logs")
def get_audit_logs(doc_id: int):
    conn = get_db_connection()
    logs = conn.execute("SELECT * FROM audit_logs WHERE doc_id=? ORDER BY id DESC", (doc_id,)).fetchall()
    conn.close()
    return [dict(log) for log in logs]
