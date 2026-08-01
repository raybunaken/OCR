import os
import io
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

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

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
            "Anda adalah asisten admin asuransi. Tugas Anda adalah mengekstrak teks menjadi format JSON.\n"
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
            model="llama-3.3-70b-versatile",
            temperature=0.2,
            max_tokens=4000,
            response_format={"type": "json_object"}
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

def extract_from_image_vision(base64_image):
    """Mengekstrak data JSON langsung dari gambar menggunakan Groq Vision"""
    fallback_data = {
        "jenis_jaminan": "-", "nomor_jaminan": "-", "nilai_jaminan": "-", 
        "principal": "-", "obligee": "-", "pekerjaan": "-", 
        "masa_berlaku": "-", "teks_asli": "Pengekstrakan dari gambar."
    }
    if not groq_client:
        return fallback_data
        
    try:
        prompt = (
            "Anda adalah sistem OCR asuransi. Ekstrak informasi dari gambar Surety Bond ini "
            "dan berikan respons HANYA berupa JSON murni dengan struktur berikut:\n"
            "{\n"
            '  "jenis_jaminan": "... (Jaminan Pelaksanaan, Uang Muka, dll)",\n'
            '  "nomor_jaminan": "...",\n'
            '  "nilai_jaminan": "...",\n'
            '  "principal": "... (Nama Terjamin)",\n'
            '  "obligee": "... (Penerima Jaminan)",\n'
            '  "pekerjaan": "... (Nama Proyek)",\n'
            '  "masa_berlaku": "...",\n'
            '  "teks_asli": "... (Transkrip seluruh isi teks dokumen dari atas sampai bawah)"\n'
            "}\n"
            "Jika data tidak ditemukan, isi '-'. Jangan tambahkan teks lain selain JSON."
        )
        chat = groq_client.chat.completions.create(
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            model="qwen/qwen3.6-27b",
            temperature=0.2,
            max_tokens=4000,
            response_format={"type": "json_object"}
        )
        content = chat.choices[0].message.content
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
        
        # Remove <think> tags if present
        import re
        content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL)
        
        # Find first { and last } to extract just the JSON
        start_idx = content.find('{')
        end_idx = content.rfind('}')
        if start_idx != -1 and end_idx != -1:
            content = content[start_idx:end_idx+1]
            
        return json.loads(content.strip())
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
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM dokumen WHERE id=%s", (doc_id,))
    conn.commit()
    conn.close()
    return {"status": "success"}

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
