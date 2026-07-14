import streamlit as st
from paddleocr import PaddleOCR
import sqlite3
import json
import fitz
import numpy as np
import pandas as pd
import datetime
from PIL import Image
from groq import Groq

# --- KONFIGURASI HALAMAN ---
st.set_page_config(page_title="Arsip Asuransi", page_icon="Arsip", layout="wide")

# --- KUSTOMISASI UKURAN FONT BESAR UNTUK LANSIA ---
st.markdown("""
<style>
    /* Mengubah ukuran font secara global (untuk teks biasa) */
    html, body, [class*="css"] {
        font-size: 20px !important; 
    }
    
    /* Membesarkan label input, teks area, dan teks tombol */
    .stTextInput label p, .stTextArea label p, .stButton button p, .stDownloadButton button p {
        font-size: 22px !important;
        font-weight: bold !important;
    }
    
    /* Membesarkan teks di dalam kotak input dan text area */
    .stTextInput input, .stTextArea textarea {
        font-size: 20px !important;
        line-height: 1.6 !important;
    }
    
    /* Membesarkan judul aplikasi */
    h1 {
        font-size: 40px !important;
    }
    h2, h3 {
        font-size: 32px !important;
    }
    
    /* Membesarkan teks pada tab dan expander */
    .stTabs button p, .streamlit-expanderHeader p {
        font-size: 24px !important;
        font-weight: bold !important;
    }
</style>
""", unsafe_allow_html=True)

# --- CACHE MODEL (Biar Loading Ngebut) ---
@st.cache_resource
def load_models():
    # Model di-load sekali saja, tidak berulang-ulang
    ocr_model = PaddleOCR(use_textline_orientation=True, lang='id', enable_mkldnn=False)
    client = Groq(api_key="REDACTED")
    return ocr_model, client

ocr, groq_client = load_models()

# --- SETUP DATABASE ---
def init_db():
    conn = sqlite3.connect('arsip_asuransi.db')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS dokumen (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nama_klien TEXT,
            teks_dokumen TEXT
        )
    ''')
    # Tambahkan kolom baru untuk data terstruktur jika belum ada
    try:
        cursor.execute("ALTER TABLE dokumen ADD COLUMN jenis_dokumen TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE dokumen ADD COLUMN nomor_identitas TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE dokumen ADD COLUMN nilai_proyek TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE dokumen ADD COLUMN obligee TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE dokumen ADD COLUMN pekerjaan TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE dokumen ADD COLUMN masa_berlaku TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE dokumen ADD COLUMN created_at TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE dokumen ADD COLUMN updated_at TEXT")
    except sqlite3.OperationalError:
        pass
    conn.commit()
    conn.close()

init_db()

def load_data():
    conn = sqlite3.connect('arsip_asuransi.db')
    df = pd.read_sql_query("SELECT * FROM dokumen ORDER BY id DESC", conn)
    conn.close()
    return df

# --- FUNGSI AI AUTO-CORRECT ---
def rapikan_teks(teks_mentah):
    fallback_json = '{"jenis_jaminan": "-", "nomor_jaminan": "-", "nilai_jaminan": "-", "principal": "-", "obligee": "-", "pekerjaan": "-", "masa_berlaku": "-", "teks_asli": "' + teks_mentah.replace('"', '\\"').replace('\n', ' ') + '"}'
    if len(teks_mentah.strip()) < 20: return fallback_json
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
            temperature=0.2,
            response_format={"type": "json_object"}
        )
        return chat.choices[0].message.content
    except:
        return fallback_json

# --- UI DASHBOARD ---
st.title("Dashboard Arsip")
st.markdown("Otomatisasi ekstraksi dokumen menggunakan OCR dan AI.")

# Membuat sistem Tab
tab1, tab2, tab3 = st.tabs(["Input & Ekstrak", "Database Klien", "Ringkasan Bisnis"])

with tab1:
    col1, col2 = st.columns([1, 1.5])
    
    with col1:
        st.subheader("Upload Dokumen Baru")
        nama_klien = st.text_input("Nama Klien", placeholder="Masukkan nama klien...")
        uploaded_file = st.file_uploader("Pilih file PDF atau Gambar", type=['pdf', 'png', 'jpg', 'jpeg'])
        proses_btn = st.button("Mulai Proses Data", type="primary", use_container_width=True)

    with col2:
        st.subheader("Hasil Ekstraksi")
        
        if 'tahap_review' not in st.session_state:
            st.session_state.tahap_review = False
        if 'draft_data' not in st.session_state:
            st.session_state.draft_data = {}
            
        if proses_btn:
            if not nama_klien or not uploaded_file:
                st.error("Nama Klien dan File wajib diisi!")
            else:
                with st.spinner('Sedang memproses dokumen...'):
                    full_text = ""
                    try:
                        doc = fitz.open(stream=uploaded_file.read(), filetype="pdf" if uploaded_file.name.endswith('.pdf') else "image")
                        # Menyimpan gambar preview ke session state untuk ditampilkan nanti
                        st.session_state.preview_image = None
                        
                        for page in doc:
                            pix = page.get_pixmap()
                            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
                            
                            # Simpan halaman pertama sebagai preview
                            if st.session_state.preview_image is None:
                                st.session_state.preview_image = Image.fromarray(img)
                                
                            teks_digital = page.get_text().strip()
                            if len(teks_digital) > 20:
                                full_text += teks_digital + "\n"
                            else:
                                result = ocr.ocr(img)
                                if result:
                                    for res in result:
                                        if not res: continue
                                        if hasattr(res, 'get') and res.get('rec_texts'):
                                            full_text += " ".join(res.get('rec_texts')) + " "
                                        elif hasattr(res, 'rec_texts') and res.rec_texts:
                                            full_text += " ".join(res.rec_texts) + " "
                                        elif isinstance(res, list):
                                            for line in res:
                                                if isinstance(line, (list, tuple)) and len(line) >= 2:
                                                    full_text += line[1][0] + " "
                                full_text += "\n"
                        
                        json_str = rapikan_teks(full_text)
                        try:
                            data_ekstrak = json.loads(json_str)
                        except:
                            data_ekstrak = {"jenis_jaminan": "-", "nomor_jaminan": "-", "nilai_jaminan": "-", "principal": "-", "obligee": "-", "pekerjaan": "-", "masa_berlaku": "-", "teks_asli": full_text}
                            
                        st.session_state.draft_data = {
                            "nama_klien": nama_klien,
                            "jenis_dokumen": data_ekstrak.get("jenis_jaminan", "-"),
                            "nomor_identitas": data_ekstrak.get("nomor_jaminan", "-"),
                            "nilai_proyek": data_ekstrak.get("nilai_jaminan", "-"),
                            "principal": data_ekstrak.get("principal", nama_klien),
                            "obligee": data_ekstrak.get("obligee", "-"),
                            "pekerjaan": data_ekstrak.get("pekerjaan", "-"),
                            "masa_berlaku": data_ekstrak.get("masa_berlaku", "-"),
                            "teks_asli": data_ekstrak.get("teks_asli", full_text)
                        }
                        st.session_state.tahap_review = True
                        
                    except Exception as e:
                        st.error(f"Terjadi kesalahan: {e}")

        if st.session_state.tahap_review:
            st.divider()
            st.info("Mohon periksa dan lengkapi data berikut sebelum disimpan ke database.")
            
            # --- LAYOUT SIDE-BY-SIDE ---
            col_img, col_form = st.columns([1, 1])
            
            with col_img:
                st.subheader("Preview Dokumen Asli")
                if 'preview_image' in st.session_state and st.session_state.preview_image is not None:
                    st.image(st.session_state.preview_image, use_column_width=True)
                else:
                    st.info("Preview gambar tidak tersedia.")
            
            with col_form:
                st.subheader("Form Hasil Ekstraksi AI")
                with st.form("form_review"):
                    rev_jenis = st.text_input("Jenis Jaminan", value=st.session_state.draft_data['jenis_dokumen'])
                    rev_nomor = st.text_input("Nomor Jaminan", value=st.session_state.draft_data['nomor_identitas'])
                    rev_nilai = st.text_input("Nilai Jaminan", value=st.session_state.draft_data['nilai_proyek'])
                    rev_principal = st.text_input("Principal (Terjamin)", value=st.session_state.draft_data['principal'])
                    rev_obligee = st.text_input("Obligee (Penerima Jaminan)", value=st.session_state.draft_data['obligee'])
                    rev_pekerjaan = st.text_input("Pekerjaan / Proyek", value=st.session_state.draft_data['pekerjaan'])
                    rev_masa = st.text_input("Masa Berlaku", value=st.session_state.draft_data['masa_berlaku'])
                    
                    st.markdown("**Teks Asli Dokumen (Bisa diedit/dirapikan):**")
                    rev_teks = st.text_area("Teks Asli", value=st.session_state.draft_data['teks_asli'], height=500, label_visibility="collapsed")
                    
                    simpan_btn = st.form_submit_button("Simpan ke Database", type="primary", use_container_width=True)
                    
                    if simpan_btn:
                        waktu_sekarang = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        conn = sqlite3.connect('arsip_asuransi.db')
                        cursor = conn.cursor()
                        cursor.execute("""
                            INSERT INTO dokumen (nama_klien, jenis_dokumen, nomor_identitas, nilai_proyek, obligee, pekerjaan, masa_berlaku, teks_dokumen, created_at, updated_at) 
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (rev_principal, rev_jenis, rev_nomor, rev_nilai, rev_obligee, rev_pekerjaan, rev_masa, rev_teks, waktu_sekarang, waktu_sekarang))
                        conn.commit()
                        conn.close()
                        
                        st.success("Data berhasil disimpan secara permanen!")
                        st.session_state.tahap_review = False # Reset form

with tab2:
    st.subheader("Semua Data Arsip")
    df = load_data()
    
    if not df.empty:
        # --- FITUR PENCARIAN & FILTER ---
        col_search, col_jenis, col_sort = st.columns([2, 1, 1])
        
        with col_search:
            search_query = st.text_input("Cari berdasarkan Nama, Nomor, Pekerjaan, atau Obligee:")
            
        with col_jenis:
            pilihan_jenis = ["Semua"] + list(df['jenis_dokumen'].dropna().unique())
            filter_jenis = st.selectbox("Filter Jenis Jaminan:", pilihan_jenis)
            
        with col_sort:
            sort_order = st.selectbox("Urutkan:", ["Terbaru", "Terlama"])

        # Terapkan Filter Pencarian (Hanya mencari di kolom penting, TIDAK mencari di isi paragraf yang panjang)
        if search_query:
            mask_nama = df['nama_klien'].astype(str).str.contains(search_query, case=False, na=False)
            mask_nomor = df['nomor_identitas'].astype(str).str.contains(search_query, case=False, na=False)
            mask_pekerjaan = df['pekerjaan'].astype(str).str.contains(search_query, case=False, na=False)
            mask_obligee = df['obligee'].astype(str).str.contains(search_query, case=False, na=False)
            df = df[mask_nama | mask_nomor | mask_pekerjaan | mask_obligee]
            
        # Terapkan Filter Jenis
        if filter_jenis != "Semua":
            df = df[df['jenis_dokumen'] == filter_jenis]
            
        # Terapkan Sorting
        if sort_order == "Terlama":
            df = df.sort_values(by="id", ascending=True)
        else:
            df = df.sort_values(by="id", ascending=False)
            
        st.caption(f"Menampilkan {len(df)} dokumen.")
        
        # Tampilan Card View menggunakan Expander (Bisa Edit & Delete)
        for _, row in df.iterrows():
            jenis = row.get('jenis_dokumen') if pd.notna(row.get('jenis_dokumen')) else '-'
            nilai = row.get('nilai_proyek') if pd.notna(row.get('nilai_proyek')) else '-'
            nama = row.get('nama_klien') if pd.notna(row.get('nama_klien')) else '-'
            created = row.get('created_at') if pd.notna(row.get('created_at')) else '-'
            updated = row.get('updated_at') if pd.notna(row.get('updated_at')) else '-'
            
            header_teks = f"{nama} | {jenis} | {nilai} (ID: {row['id']})"
            
            with st.expander(header_teks, expanded=False):
                # Info Waktu dan Tombol Hapus
                col_info, col_del = st.columns([3, 1])
                with col_info:
                    st.caption(f"Ditambahkan: {created} | Terakhir Diedit: {updated}")
                with col_del:
                    if st.button("Hapus Dokumen", key=f"del_{row['id']}", type="primary"):
                        conn = sqlite3.connect('arsip_asuransi.db')
                        cursor = conn.cursor()
                        cursor.execute("DELETE FROM dokumen WHERE id=?", (row['id'],))
                        conn.commit()
                        conn.close()
                        st.rerun()
                
                st.divider()
                # Form Edit
                with st.form(key=f"edit_form_{row['id']}"):
                    st.markdown("**Form Edit Data**")
                    colX, colY = st.columns(2)
                    e_nama = colX.text_input("Principal (Terjamin)", value=nama)
                    e_jenis = colY.text_input("Jenis Jaminan", value=jenis)
                    
                    colA, colB, colC = st.columns(3)
                    e_nomor = colA.text_input("Nomor Jaminan", value=row.get('nomor_identitas') if pd.notna(row.get('nomor_identitas')) else '-')
                    e_obligee = colB.text_input("Obligee", value=row.get('obligee') if pd.notna(row.get('obligee')) else '-')
                    e_masa = colC.text_input("Masa Berlaku", value=row.get('masa_berlaku') if pd.notna(row.get('masa_berlaku')) else '-')
                    
                    colD, colE = st.columns(2)
                    e_nilai = colD.text_input("Nilai Jaminan", value=nilai)
                    e_pekerjaan = colE.text_input("Pekerjaan / Proyek", value=row.get('pekerjaan') if pd.notna(row.get('pekerjaan')) else '-')
                    
                    e_teks = st.text_area(label="Teks Asli Dokumen:", value=row.get('teks_dokumen', ''), height=500)
                    
                    btn_save_edit = st.form_submit_button("Simpan Perubahan")
                    if btn_save_edit:
                        waktu_sekarang = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        conn = sqlite3.connect('arsip_asuransi.db')
                        cursor = conn.cursor()
                        cursor.execute("""
                            UPDATE dokumen 
                            SET nama_klien=?, jenis_dokumen=?, nomor_identitas=?, nilai_proyek=?, obligee=?, pekerjaan=?, masa_berlaku=?, teks_dokumen=?, updated_at=?
                            WHERE id=?
                        """, (e_nama, e_jenis, e_nomor, e_nilai, e_obligee, e_pekerjaan, e_masa, e_teks, waktu_sekarang, row['id']))
                        conn.commit()
                        conn.close()
                        st.success("Data berhasil diupdate!")
                        st.rerun()
    else:
        st.info("Database masih kosong atau data tidak ditemukan.")

with tab3:
    st.subheader("Ringkasan Performa Bisnis")
    df = load_data()
    
    if df.empty:
        st.info("Belum ada data untuk ditampilkan di Dashboard.")
    else:
        total_klien = len(df)
        
        if 'jenis_dokumen' in df.columns:
            try:
                top_jaminan = df['jenis_dokumen'].value_counts().idxmax()
                top_jaminan_count = df['jenis_dokumen'].value_counts().max()
            except:
                top_jaminan = "-"
                top_jaminan_count = 0
        else:
            top_jaminan = "-"
            top_jaminan_count = 0
            
        total_nilai = 0
        if 'nilai_proyek' in df.columns:
            for val in df['nilai_proyek']:
                if pd.notna(val) and isinstance(val, str):
                    try:
                        clean_str = val.replace("Rp", "").split(",")[0].replace(".", "").strip()
                        if clean_str.isdigit():
                            total_nilai += int(clean_str)
                    except:
                        pass
        
        if total_nilai >= 1_000_000_000:
            nilai_str = f"Rp {total_nilai / 1_000_000_000:.1f} Milyar"
        elif total_nilai >= 1_000_000:
            nilai_str = f"Rp {total_nilai / 1_000_000:.1f} Juta"
        else:
            nilai_str = f"Rp {total_nilai:,}"
            
        col1, col2, col3 = st.columns(3)
        col1.metric("Total Dokumen Tersimpan", f"{total_klien} Dokumen")
        col2.metric("Jaminan Terbanyak", top_jaminan, f"{top_jaminan_count} Klien")
        col3.metric("Estimasi Total Nilai Proyek", nilai_str)
        
        st.divider()
        
        st.subheader("Komposisi Jenis Jaminan")
        colA, colB = st.columns([1, 1.5])
        
        with colA:
            if 'jenis_dokumen' in df.columns:
                dist_jenis = df['jenis_dokumen'].value_counts()
                st.bar_chart(dist_jenis)
                
        with colB:
            st.markdown("**5 Aktivitas Terakhir**")
            recent_df = df.sort_values(by="id", ascending=False).head(5)
            display_df = recent_df[['created_at', 'nama_klien', 'jenis_dokumen', 'nilai_proyek']].copy()
            
            # Format tanggal biar lebih cantik (hanya tanggal)
            display_df['created_at'] = display_df['created_at'].apply(lambda x: str(x)[:10] if pd.notna(x) else x)
            
            display_df.columns = ['Tanggal', 'Klien', 'Jenis', 'Nilai']
            st.dataframe(display_df, use_container_width=True, hide_index=True)
