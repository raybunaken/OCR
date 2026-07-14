import streamlit as st
import sqlite3
import pandas as pd
from groq import Groq

# --- KONFIGURASI HALAMAN ---
st.set_page_config(page_title="Asisten AI", page_icon="Robot", layout="wide")

# --- KUSTOMISASI FONT LANSIA ---
st.markdown("""
<style>
    html, body, [class*="css"] { font-size: 20px !important; }
    .stSelectbox label p, .stButton button p { font-size: 22px !important; font-weight: bold !important; }
    h1 { font-size: 40px !important; }
    h2, h3 { font-size: 32px !important; }
    div[data-testid="stChatMessageContent"] { font-size: 20px !important; line-height: 1.6 !important; }
    .stChatInput textarea { font-size: 20px !important; }
</style>
""", unsafe_allow_html=True)

# --- INIT GROQ ---
@st.cache_resource
def load_groq():
    return Groq(api_key="REDACTED")

groq_client = load_groq()

st.title("Asisten Chatbot AI")
st.markdown("Ngobrol dan minta tolong AI untuk memproses data dari dokumen Anda.")

# --- AMBIL DATA DARI DB ---
def load_client_list():
    try:
        conn = sqlite3.connect('arsip_asuransi.db')
        # Ambil nama klien, jenis, dan nilai proyek untuk memperjelas dropdown
        df = pd.read_sql_query("SELECT id, nama_klien, jenis_dokumen, nilai_proyek, teks_dokumen FROM dokumen ORDER BY id DESC", conn)
        conn.close()
        return df
    except:
        return pd.DataFrame()

df_dokumen = load_client_list()

if df_dokumen.empty:
    st.warning("Belum ada data dokumen di database. Silakan upload dokumen di halaman utama terlebih dahulu.")
else:
    # --- STRATEGI HEMAT TOKEN (DROPDOWN) ---
    st.subheader("1. Pilih Dokumen Konteks")
    st.info("Pilih satu dokumen yang ingin Anda bahas. AI hanya akan membaca dokumen ini sehingga jauh lebih hemat kuota dan jawabannya lebih akurat.")
    
    # Buat list opsi untuk dropdown
    opsi_dokumen = []
    for _, row in df_dokumen.iterrows():
        jenis = row.get('jenis_dokumen') if pd.notna(row.get('jenis_dokumen')) else '-'
        label = f"{row['nama_klien']} | {jenis} (ID: {row['id']})"
        opsi_dokumen.append(label)
        
    pilihan_index = st.selectbox("Dokumen Klien:", range(len(opsi_dokumen)), format_func=lambda x: opsi_dokumen[x])
    
    # Ambil teks dari dokumen yang dipilih
    dokumen_terpilih = df_dokumen.iloc[pilihan_index]
    teks_konteks = dokumen_terpilih['teks_dokumen']
    
    st.divider()
    st.subheader("2. Ruang Obrolan")
    
    # --- CHAT HISTORY ---
    # Kita menggunakan ID dokumen agar chat tidak tercampur saat ganti dokumen
    chat_key = f"messages_{dokumen_terpilih['id']}"
    if chat_key not in st.session_state:
        st.session_state[chat_key] = [
            {"role": "assistant", "content": f"Halo! Saya sudah membaca dokumen milik **{dokumen_terpilih['nama_klien']}**. Ada yang bisa saya bantu? (Misal: 'Buatkan draft pesan penagihan untuk klien ini' atau 'Berapa nilai proyeknya?')"}
        ]
        
    # Tampilkan history
    for msg in st.session_state[chat_key]:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])
            
    # Input user
    if prompt := st.chat_input("Ketik pesan Anda di sini..."):
        # Tambah pesan user ke layar
        st.session_state[chat_key].append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.markdown(prompt)
            
        # Panggil Groq AI
        with st.chat_message("assistant"):
            with st.spinner("Berpikir..."):
                try:
                    # Sistem Prompt + Konteks Dokumen (Strategi RAG Sederhana)
                    system_prompt = (
                        "Anda adalah asisten asuransi yang cerdas. Gunakan DOKUMEN KLIEN di bawah ini sebagai SATU-SATUNYA referensi Anda.\n"
                        "Tugas Anda adalah menjawab pertanyaan user, mengekstrak informasi, atau membuatkan draft pesan/email terkait dokumen tersebut.\n"
                        "Jika disuruh membuat draft, gunakan bahasa Indonesia yang sopan dan profesional.\n\n"
                        "=== DOKUMEN KLIEN ===\n" + teks_konteks
                    )
                    
                    # Bangun riwayat chat untuk Groq
                    api_messages = [{"role": "system", "content": system_prompt}]
                    
                    # Ambil 5 riwayat terakhir agar AI ingat konteks obrolan (hemat token)
                    recent_history = st.session_state[chat_key][-5:]
                    for hist in recent_history:
                        api_messages.append({"role": hist["role"], "content": hist["content"]})
                        
                    # Request ke Groq
                    chat_completion = groq_client.chat.completions.create(
                        messages=api_messages,
                        model="llama-3.1-8b-instant",
                        temperature=0.5
                    )
                    
                    respon_ai = chat_completion.choices[0].message.content
                    st.markdown(respon_ai)
                    st.session_state[chat_key].append({"role": "assistant", "content": respon_ai})
                    
                except Exception as e:
                    st.error(f"Terjadi kesalahan koneksi AI: {e}")
