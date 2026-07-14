import sqlite3
import random
from datetime import datetime, timedelta

def get_random_date():
    # Random date within the last 30 days
    now = datetime.now()
    random_days = random.randint(0, 30)
    random_hours = random.randint(0, 23)
    random_minutes = random.randint(0, 59)
    past_date = now - timedelta(days=random_days, hours=random_hours, minutes=random_minutes)
    return past_date.strftime("%Y-%m-%d %H:%M:%S")

def format_rupiah(angka):
    # Format to Indonesian Rupiah standard format
    return f"Rp {angka:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

clients = ["PT. BANGUN NUSANTARA", "CV. MAJU BERSAMA", "PT. ADHI KARYA (PERSERO) TBK", "PT. WASKITA KARYA", "CV. SENTOSA JAYA", "PT. MULTI SARANA", "PT. SINAR TERANG", "CV. KARYA ABADI", "PT. INFRASTRUKTUR INDONESIA", "PT. BINTANG TIMUR"]
jenis_list = ["Jaminan Penawaran", "Jaminan Pelaksanaan", "Jaminan Uang Muka", "Jaminan Pemeliharaan"]
obligees = ["Dinas PUPR Provinsi", "Kementerian Kesehatan", "Dinas Pendidikan Daerah", "RSUD Kabupaten", "Pemerintah Kota"]

dummy_data = []

for i in range(15):
    nama_klien = random.choice(clients)
    jenis_dokumen = random.choice(jenis_list)
    nomor_identitas = f"SBJT-{random.randint(1000, 9999)}/2026"
    
    # Random value between 50 Juta to 5 Milyar
    nilai_int = random.randint(50, 5000) * 1000000
    nilai_proyek = format_rupiah(nilai_int)
    
    obligee = random.choice(obligees)
    pekerjaan = f"Pekerjaan Pengadaan Barang/Jasa di lingkungan {obligee} Tahun Anggaran 2026"
    masa_berlaku = f"1 Jan 2026 - 31 Des 2026"
    teks_dokumen = "Ini adalah dokumen dummy hasil generate untuk keperluan testing dashboard. Teks asli tidak tersedia secara lengkap karena digenerate sistem."
    
    date_str = get_random_date()
    
    dummy_data.append((
        nama_klien, jenis_dokumen, nomor_identitas, nilai_proyek, obligee, pekerjaan, masa_berlaku, teks_dokumen, date_str, date_str
    ))

conn = sqlite3.connect('arsip_asuransi.db')
cursor = conn.cursor()

# Insert data
cursor.executemany("""
    INSERT INTO dokumen (nama_klien, jenis_dokumen, nomor_identitas, nilai_proyek, obligee, pekerjaan, masa_berlaku, teks_dokumen, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
""", dummy_data)

conn.commit()
conn.close()

print(f"Berhasil menginjeksi {len(dummy_data)} data dummy ke arsip_asuransi.db!")
