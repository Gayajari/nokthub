// ============================================================
// NOKT HUB — App Core (Home page logic)
// ============================================================
import {
  db, collection, query, where, orderBy, limit, getDocs, doc, getDoc,
  addDoc, updateDoc, increment, serverTimestamp, onSnapshot
} from "./firebase-config.js";

const PAGE_SIZE = 12;
let allPublishedVideos = [];
let currentPage = 1;

const DEFAULT_LOGO_URL = "https://co.com";

const PLACEHOLDER_THUMB = 'https://placeholder.com';
let siteSettings = {};

async function loadSiteSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "site"));
    siteSettings = snap.exists() ? snap.data() : {};
    // Simpan ke localStorage supaya kunjungan berikutnya bisa langsung
    // menerapkan warna tema SEBELUM halaman digambar (lihat script anti-flash
    // di <head> setiap file HTML) — menghindari efek "kedip" warna default.
    try { localStorage.setItem("nokt_settings_cache", JSON.stringify(siteSettings)); } catch (e) {}
  } catch (e) { siteSettings = {}; }
}

// ---------- Terapkan cache dulu (instan, tanpa nunggu network) ----------
// Dipanggil SEBELUM loadSiteSettings() (yang nunggu Firestore). Tujuannya:
// untuk pengunjung yang sudah pernah buka situs ini sebelumnya, nama/warna
// situs langsung terisi dari data kunjungan terakhir yang tersimpan di
// localStorage — jadi elemen yang tadinya disembunyikan lewat script
// anti-flash di <head> bisa langsung dimunculkan lagi dengan teks yang
// (kemungkinan besar) sudah benar, tanpa nunggu round-trip ke server.
// Kalau ternyata nama di server sudah berubah sejak kunjungan terakhir,
// applySiteSettings() akan dipanggil ULANG setelah data asli datang
// (lihat alur di bagian bawah file), jadi tetap ter-update.
function applyCachedSiteSettings() {
  let cached = {};
  try {
    cached = JSON.parse(localStorage.getItem("nokt_settings_cache") || "null") || {};
  } catch (e) { cached = {}; }
  if (Object.keys(cached).length) {
    siteSettings = cached;
    applySiteSettings();
  }
}

// ---------- Deteksi batas konten asli logo (buang ruang kosong bawaan) ----------
// MASALAH: file PNG yang di-upload admin sering SUDAH punya ruang kosong
// sendiri di sekeliling logo/wajahnya (tidak mepet sampai ke tepi kanvas
// aslinya). Kalau langsung dipadding lagi oleh buildSquareFaviconDataUrl,
// hasilnya "dobel padding" -- logo kelihatan kekecilan di tengah kotak
// favicon, dibanding favicon situs lain yang isinya penuh sampai hampir
// ke tepi.
//
// FUNGSI INI: menganalisis piksel gambar (di kanvas kecil 128x128 supaya
// cepat), membandingkan tiap piksel dengan warna di 4 sudut gambar
// (dianggap sebagai "background"), lalu mencari kotak pembatas (bounding
// box) area yang warnanya BEDA jauh dari background itu -- itulah "konten
// asli" logonya. Ruang kosong bawaan di luar kotak itu nanti dibuang
// sebelum logo dipadding ulang di buildSquareFaviconDataUrl.
// Return null kalau gagal dianalisis (mis. gambar tertutup penuh / rata
// satu warna) -- pemanggil akan pakai gambar utuh apa adanya sebagai fallback.
function detectContentBounds(img) {
  const N = 128;
  try {
    const tmp = document.createElement("canvas");
    tmp.width = N; tmp.height = N;
    const tctx = tmp.getContext("2d");
    tctx.drawImage(img, 0, 0, N, N);
    const data = tctx.getImageData(0, 0, N, N).data;

    // Warna "background" = rata-rata 4 sudut gambar.
    const corners = [[0,0],[N-1,0],[0,N-1],[N-1,N-1]];
    let bgR=0, bgG=0, bgB=0;
    corners.forEach(([x,y]) => {
      const i = (y*N + x) * 4;
      bgR += data[i]; bgG += data[i+1]; bgB += data[i+2];
    });
    bgR/=4; bgG/=4; bgB/=4;

    const COLOR_THRESHOLD = 24; // jarak warna minimal supaya dianggap "konten"
    let minX=N, minY=N, maxX=-1, maxY=-1;
    for (let y=0; y<N; y++) {
      for (let x=0; x<N; x++) {
        const i = (y*N + x) * 4;
        if (data[i+3] < 10) continue; // piksel benar-benar transparan, bukan konten
        const dr = data[i]-bgR, dg = data[i+1]-bgG, db = data[i+2]-bgB;
        if (Math.sqrt(dr*dr + dg*dg + db*db) > COLOR_THRESHOLD) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null; // tidak ada piksel yang beda cukup jauh dari background

    const scaleX = img.naturalWidth / N;
    const scaleY = img.naturalHeight / N;
    return {
      x: minX * scaleX, y: minY * scaleY,
      width: (maxX - minX + 1) * scaleX, height: (maxY - minY + 1) * scaleY
    };
  } catch (e) {
    return null; // canvas ke-taint (CORS) -- tidak bisa dianalisis
  }
}

// ---------- Auto-pad favicon jadi kotak persegi aman ----------
// MASALAH YANG DISELESAIKAN: admin bisa upload gambar apa saja lewat
// dashboard (bulat, mepet tepi, potrait/landscape, ukuran sembarang) buat
// dijadiin favicon. Favicon SELALU dirender browser di dalam kotak
// persegi -- kalau gambar aslinya bulat & mepet ke tepi kanvas, ujungnya
// gampang kepotong/keliatan pecah pas diperkecil ke 16-32px, atau kepotong
// lagi kalau platform (Android/PWA) ikut membulatkan sudut kotaknya.
//
// SOLUSI: apapun gambar yang di-set di field "favicon" dashboard, gambar
// itu digambar ulang di sini ke kanvas <canvas> persegi (128x128) dengan
// padding aman (logo diperkecil biar ada jarak ke tepi, bukan mepet) dan
// background transparan -- baru hasilnya (data URL) yang dipasang sebagai
// favicon. Jadi admin tinggal upload apa saja, tidak perlu crop/edit
// manual -- penyesuaian jadi otomatis di sini, setiap kali halaman dimuat.
function buildSquareFaviconDataUrl(url, size = 128, paddingRatio = 0.16) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        
        // Canvas dibiarkan transparan secara default (PNG Alpha)
        const pad = size * paddingRatio;
        const maxDim = size - pad * 2;

        // Auto-crop awal: deteksi bounding box isi gambar utama
        let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
        const bounds = detectContentBounds(img);
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          const boundArea = bounds.width * bounds.height;
          const fullArea = img.naturalWidth * img.naturalHeight;
          if (boundArea < fullArea * 0.92) {
            sx = bounds.x; sy = bounds.y; sw = bounds.width; sh = bounds.height;
          }
        }

        // Hitung rasio aspek dan pasang posisi gambar tepat di tengah kanvas persegi
        let dx, dy, dw, dh;
        const ratio = sw / sh;
        if (ratio > 1) {
          dw = maxDim;
          dh = maxDim / ratio;
          dx = pad;
          dy = pad + (maxDim - dh) / 2;
        } else {
          dh = maxDim;
          dw = maxDim * ratio;
          dx = pad + (maxDim - dw) / 2;
          dy = pad;
        }

        // Gambar ulang gambar hasil modifikasi ke kanvas persegi baru
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        resolve(null); // Fallback ke URL asli jika terkena batasan keamanan CORS
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Catatan: Fungsi pendukung kelanjutan halaman seperti applySiteSettings() 
// atau fungsi pemanggil inisialisasi diletakkan di bawah baris ini sesuai file asli Anda.
