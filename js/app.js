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

const DEFAULT_LOGO_URL = "https://i.ibb.co.com/nss27bKz/20260716-103634.png";

const PLACEHOLDER_THUMB = 'https://via.placeholder.com/320x180/141416/9A9A9E?text=No+Image';
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
//
// CATATAN teknis (kenapa ada try/catch & fallback): gambar diambil dari
// domain lain (ibb.co) lewat <img crossOrigin="anonymous">. Ini cuma
// berhasil dibaca ulang oleh canvas.toDataURL() kalau server gambar itu
// mengirim header CORS yang mengizinkan (Access-Control-Allow-Origin).
// Kalau ternyata TIDAK diizinkan, canvas akan "tainted" dan toDataURL()
// melempar error -- di situasi itu fungsi ini resolve(null), dan
// pemanggilnya (applySiteSettings) otomatis fallback pakai URL asli apa
// adanya (favicon tetap muncul, cuma tanpa padding otomatis).
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
        // Tidak diisi warna dulu -- canvas kosong = transparan (PNG alpha),
        // jadi tidak ada kotak putih/hitam aneh di belakang logo.
        const pad = size * paddingRatio;
        const maxDim = size - pad * 2;

        // Auto-crop: buang ruang kosong bawaan di sekeliling logo (kalau
        // ada) SEBELUM logo diperkecil+dipadding -- supaya tidak terjadi
        // dobel padding yang bikin logo kelihatan kekecilan. sx/sy/sw/sh
        // di bawah ini menentukan bagian mana dari gambar ASLI yang
        // dipakai; default-nya gambar utuh kalau deteksi gagal/tidak perlu.
        let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
        const bounds = detectContentBounds(img);
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          const boundArea = bounds.width * bounds.height;
          const fullArea = img.naturalWidth * img.naturalHeight;
          // Cuma dipakai kalau memang signifikan lebih kecil dari gambar
          // utuh (menandakan memang ada ruang kosong bawaan yang perlu
          // dibuang) -- kalau hasil deteksi hampir seluas gambar utuh,
          // abaikan saja (anggap tidak ada yang perlu di-crop).
          if (boundArea < fullArea * 0.92) {
            sx = bounds.x; sy = bounds.y; sw = bounds.width; sh = bounds.height;
          }
        }

        // Skala hasil crop supaya sisi terpanjangnya pas di maxDim, lalu
        // di-tengahkan -- ini yang memastikan logo apapun proporsinya
        // (persegi, potrait, landscape) selalu berakhir dengan jarak
        // aman yang sama ke semua tepi kanvas.
        const scale = Math.min(maxDim / sw, maxDim / sh);
        const drawW = sw * scale;
        const drawH = sh * scale;
        const dx = (size - drawW) / 2;
        const dy = (size - drawH) / 2;
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, drawW, drawH);
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        // Canvas ke-taint (CORS ditolak server gambar) atau error lain --
        // gagal diproses, biarkan caller pakai URL asli sebagai fallback.
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ---------- Terapkan Pengaturan Website ke tampilan ----------
// Field-field ini (Nama Website, Logo, Favicon, Warna Tema, GA ID) disambungkan
// ke semua tempat nama web muncul di halaman. Kalau elemen terkait belum ada
// di suatu halaman, bagian itu dilewati saja (aman, tidak error).
function applySiteSettings() {
  const s = siteSettings;
  const name = s.siteName; // kalau kosong, HTML tetap tampil default "NOKT HUB" (fallback aman)

  // ---- Judul tab browser ----
  // Sebelumnya hanya jalan kalau ada elemen <title id="site-title">.
  // Sekarang langsung ganti teks document.title, jadi otomatis berlaku
  // di SEMUA halaman walau id-nya beda-beda (mis. watch.html pakai
  // id="page-title") atau bahkan tidak punya id sama sekali (contact.html dll).
  if (name) {
    document.title = document.title.replace(/NOKT HUB/gi, name);
  }

  // ---- Nama brand utuh (header logo-text & footer brand link) ----
  document.querySelectorAll(".site-brand-text").forEach(el => {
    if (name) el.textContent = name;
    el.style.visibility = "visible"; // reveal lagi meski cache sempat sembunyikan teks
  });

  // ---- Nama di tengah kalimat (mis. teks copyright footer) ----
  // Dibungkus <span class="site-name-inline">NOKT HUB</span> di HTML supaya
  // saat diganti, hanya kata namanya yang berubah, kalimat sekitarnya utuh.
  // Perlakuan sama seperti .site-brand-text: disembunyikan dulu lewat script
  // anti-flash di <head>, baru dimunculkan lagi di sini setelah nama siap —
  // supaya tidak sempat kelihatan nama lama sekilas (anti-kedip).
  document.querySelectorAll(".site-name-inline").forEach(el => {
    if (name) el.textContent = name;
    el.style.visibility = "visible";
  });

  // ---- Email kontak & email DMCA ----
  // Dibungkus class "site-contact-email" (contact.html) dan "site-dmca-email"
  // (dmca.html) di HTML. Diisi dari field contactEmail / dmcaEmail di
  // dashboard, jadi cukup ganti sekali di panel tanpa perlu edit HTML.
  // Sama seperti nama situs: elemen ini sempat disembunyikan lewat script
  // anti-flash di <head>, lalu dimunculkan lagi di sini setelah teks & href
  // mailto-nya siap — supaya tidak sempat kelihatan email placeholder lama.
  const contactEmail = s.contactEmail;
  document.querySelectorAll(".site-contact-email").forEach(el => {
    if (contactEmail) {
      el.textContent = contactEmail;
      el.href = "mailto:" + contactEmail;
    }
    el.style.visibility = "visible";
  });

  const dmcaEmail = s.dmcaEmail || s.contactEmail; // fallback ke contactEmail kalau dmcaEmail belum diisi
  document.querySelectorAll(".site-dmca-email").forEach(el => {
    if (dmcaEmail) {
      el.textContent = dmcaEmail;
      el.href = "mailto:" + dmcaEmail;
    }
    el.style.visibility = "visible";
  });

  // ---- Logo gambar + alt text ----
  const logoImg = document.getElementById("site-logo-img");
  if (logoImg) {
    logoImg.src = s.logoUrl || DEFAULT_LOGO_URL;
    if (name) logoImg.alt = `${name} logo`;
  }

  // ---- SEO: meta description, Open Graph, JSON-LD milik SITE (bukan per-video) ----
  // Pakai id khusus "site-*" / "og-site-*" supaya tidak bentrok dengan
  // meta per-video di watch.html yang dikelola watch.js (id="meta-desc",
  // "og-title", dst). Kalau elemen id ini tidak ada di suatu halaman
  // (mis. watch.html, contact.html), bagian ini otomatis dilewati.
  const metaDesc = document.getElementById("site-meta-desc");
  if (name && metaDesc) {
    metaDesc.setAttribute("content", metaDesc.getAttribute("content").replace(/NOKT HUB/gi, name));
  }
  const ogTitle = document.getElementById("og-site-title");
  if (name && ogTitle) {
    ogTitle.setAttribute("content", ogTitle.getAttribute("content").replace(/NOKT HUB/gi, name));
  }
  const ogDesc = document.getElementById("og-site-desc");
  if (name && ogDesc) {
    ogDesc.setAttribute("content", ogDesc.getAttribute("content").replace(/NOKT HUB/gi, name));
  }
  const jsonLd = document.getElementById("site-json-ld");
  if (name && jsonLd) {
    try {
      const data = JSON.parse(jsonLd.textContent);
      data.name = name;
      jsonLd.textContent = JSON.stringify(data);
    } catch (e) { /* biarkan JSON-LD default kalau parsing gagal */ }
  }

  // ---- Favicon: auto-pad jadi kotak persegi aman sebelum dipasang ----
  // FIX: dulu faviconLink.href langsung diisi s.favicon apa adanya --
  // kalau gambar yang di-upload admin bulat/mepet tepi, hasilnya bisa
  // kepotong/pecah pas jadi favicon kecil. Sekarang, APAPUN yang di-set
  // (custom dari dashboard ATAU fallback ke logo default) selalu
  // diproses dulu lewat buildSquareFaviconDataUrl() di atas -- jadi
  // hasil akhirnya selalu kotak persegi dengan padding aman, tanpa admin
  // perlu crop/edit manual tiap ganti gambar. Kalau proses gagal (mis.
  // dibatasi CORS oleh server gambar), otomatis fallback ke URL asli
  // (favicon tetap tampil, cuma tanpa padding).
  const faviconLink = document.getElementById("site-favicon");
  if (faviconLink) {
    const rawFavicon = s.favicon || DEFAULT_LOGO_URL;
    buildSquareFaviconDataUrl(rawFavicon).then(dataUrl => {
      faviconLink.href = dataUrl || rawFavicon;
    });
  }

  const themeMeta = document.getElementById("meta-theme-color");
  if (s.themeColor) {
    if (themeMeta) themeMeta.setAttribute("content", s.themeColor);
    document.documentElement.style.setProperty("--accent", s.themeColor);
  }

  if (s.gaId && !document.getElementById("ga-script-tag")) {
    const script1 = document.createElement("script");
    script1.id = "ga-script-tag";
    script1.async = true;
    script1.src = `https://www.googletagmanager.com/gtag/js?id=${s.gaId}`;
    document.head.appendChild(script1);

    const script2 = document.createElement("script");
    script2.textContent = `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${s.gaId}');
    `;
    document.head.appendChild(script2);
  }
}

function listenVideos(onUpdate) {
  const q = query(
    collection(db, "videos"),
    where("status", "==", "publish"),
    orderBy("uploadedAt", "desc")
  );
  return onSnapshot(q, (snap) => {
    allPublishedVideos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    onUpdate(allPublishedVideos);
  });
}

function computePopularScore(v) {
  return (v.viewCount || 0) * 0.6
       + (v.likeCount || 0) * 0.2
       + (v.searchTagCount || 0) * 0.1
       + (v.shareCount || 0) * 0.1;
}

// ---------- Normalisasi link gambar (jaring pengaman untuk data lama) ----------
// Sama dengan yang dijalankan admin.js saat menyimpan, dijalankan lagi di sini
// supaya video yang thumbnail-nya sempat tersimpan sebagai link viewer
// (Google Drive/Dropbox mentah) sebelum fitur ini ada tetap bisa tampil.
function normalizeThumbLink(url) {
  if (!url) return url;
  const trimmed = url.trim();

  const gdrive = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/)
              || trimmed.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/)
              || trimmed.match(/drive\.google\.com\/uc\?id=([a-zA-Z0-9_-]+)/);
  if (gdrive) return `https://drive.google.com/uc?export=view&id=${gdrive[1]}`;

  if (trimmed.includes("dropbox.com")) {
    if (trimmed.includes("dl=0")) return trimmed.replace("dl=0", "raw=1");
    if (!trimmed.includes("raw=1") && !trimmed.includes("dl=1")) {
      return trimmed + (trimmed.includes("?") ? "&raw=1" : "?raw=1");
    }
  }

  return trimmed;
}

// ---------- Thumbnail fallback berlapis ----------
function extractAutoThumb(embedUrl) {
  if (!embedUrl) return null;
  const yt = embedUrl.match(/youtu\.be\/([a-zA-Z0-9_-]+)/)
          || embedUrl.match(/[?&]v=([a-zA-Z0-9_-]+)/)
          || embedUrl.match(/embed\/([a-zA-Z0-9_-]+)/);
  if (yt) return `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg`;

  const vimeo = embedUrl.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return `https://vumbnail.com/${vimeo[1]}.jpg`;

  return null;
}

function buildThumbChain(v) {
  const chain = [];
  if (v.thumbnail) chain.push(normalizeThumbLink(v.thumbnail));
  const auto = extractAutoThumb(v.embedUrl);
  if (auto) chain.push(auto);
  if (siteSettings.defaultThumbnail) chain.push(siteSettings.defaultThumbnail);
  chain.push(PLACEHOLDER_THUMB);
  return chain;
}

window.__nokthubThumbFallback = function (imgEl, videoId) {
  const v = allPublishedVideos.find(x => x.id === videoId);
  if (!v) { imgEl.src = PLACEHOLDER_THUMB; return; }
  const chain = buildThumbChain(v);
  const step = parseInt(imgEl.dataset.fallbackStep || "0", 10) + 1;
  if (chain[step]) {
    imgEl.dataset.fallbackStep = step;
    imgEl.src = chain[step];
  }
};

function renderVideoCard(v) {
  const url = `watch.html?id=${v.id}`;
  const chain = buildThumbChain(v);
  return `
    <a class="video-card" href="${url}">
      <div class="thumb-wrap">
        <img src="${chain[0]}" data-fallback-step="0"
             onerror="window.__nokthubThumbFallback(this, '${v.id}')"
             alt="${escapeHtml(v.title)}" loading="lazy">
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(v.title)}</div>
        <div class="card-meta">
          <span>${(v.viewCount||0).toLocaleString('id-ID')} view</span>
          <span>•</span>
          <span>${escapeHtml(v.category||'-')}</span>
        </div>
      </div>
    </a>`;
}

function escapeHtml(s=""){
  return s.replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}

function renderLatest() {
  const el = document.getElementById("latest-grid");
  if (!el) return;
  const latest = [...allPublishedVideos]
    .sort((a,b)=> (b.uploadedAt?.seconds||0) - (a.uploadedAt?.seconds||0))
    .slice(0, 8);
  el.innerHTML = latest.map(renderVideoCard).join("") || emptyState("Belum ada video terbaru");
}

function renderPopular() {
  const el = document.getElementById("popular-grid");
  if (!el) return;
  const popular = [...allPublishedVideos]
    .sort((a,b)=> computePopularScore(b) - computePopularScore(a))
    .slice(0, 8);
  el.innerHTML = popular.map(renderVideoCard).join("") || emptyState("Belum ada video populer");
}

function renderTrendingTags() {
  const el = document.getElementById("trending-tags");
  if (!el) return;
  const tagCount = {};
  allPublishedVideos.forEach(v => (v.tags||[]).forEach(t => {
    tagCount[t] = (tagCount[t]||0) + 1;
  }));
  const sorted = Object.entries(tagCount).sort((a,b)=>b[1]-a[1]).slice(0, 15);
  el.innerHTML = sorted.map(([tag]) =>
    `<a class="tag-chip" href="tag.html?t=${encodeURIComponent(tag)}">#${escapeHtml(tag)}</a>`
  ).join("") || emptyState("Belum ada tag trending");
}

function renderTrendingCategories() {
  const el = document.getElementById("trending-categories");
  if (!el) return;
  const catCount = {};
  allPublishedVideos.forEach(v => {
    if (!v.category) return;
    catCount[v.category] = (catCount[v.category]||0) + (v.viewCount||0);
  });
  const sorted = Object.entries(catCount).sort((a,b)=>b[1]-a[1]).slice(0, 10);
  el.innerHTML = sorted.map(([cat]) =>
    `<a class="cat-chip" href="category.html?c=${encodeURIComponent(cat)}">${escapeHtml(cat)}</a>`
  ).join("") || emptyState("Belum ada kategori trending");
}

function emptyState(msg){
  return `<p style="color:var(--text-muted);padding:20px 0">${msg}</p>`;
}

function renderHero() {
  const wrap = document.getElementById("hero-slider");
  const dotsWrap = document.getElementById("hero-dots");
  if (!wrap) return;
  const slides = [...allPublishedVideos]
    .sort((a,b)=> (b.uploadedAt?.seconds||0) - (a.uploadedAt?.seconds||0))
    .slice(0, 5);
  if (!slides.length) return;

  wrap.innerHTML = slides.map((v,i) => `
    <a class="hero-slide ${i===0?'active':''}" data-i="${i}" href="watch.html?id=${v.id}"
       style="background-image:url('${buildThumbChain(v)[0]}');transition:opacity .6s ease, transform .6s ease;">
      <div class="hero-info">
        <div class="eyebrow">Video Terbaru</div>
        <h1>${escapeHtml(v.title)}</h1>
        <p>${escapeHtml((v.description||"").slice(0,120))}</p>
        <span class="btn">Tonton Sekarang</span>
      </div>
    </a>`).join("");

  dotsWrap.innerHTML = slides.map((_,i) =>
    `<span data-i="${i}" class="${i===0?'active':''}"></span>`).join("");

  wrap.parentElement.querySelectorAll(".hero-nav-arrow").forEach(el => el.remove());

  let idx = 0;
  const goTo = (n) => {
    idx = (n + slides.length) % slides.length;
    wrap.querySelectorAll(".hero-slide").forEach((s,i)=> s.classList.toggle("active", i===idx));
    dotsWrap.querySelectorAll("span").forEach((s,i)=> s.classList.toggle("active", i===idx));
  };
  const rotate = () => goTo(idx + 1);

  let timer = null;
  const startAutoplay = () => { if (slides.length > 1) timer = setInterval(rotate, 6000); };
  const stopAutoplay = () => { if (timer) clearInterval(timer); };
  startAutoplay();

  dotsWrap.querySelectorAll("span").forEach(dot => {
    dot.addEventListener("click", () => {
      goTo(parseInt(dot.dataset.i));
      stopAutoplay(); startAutoplay();
    });
  });

  if (slides.length > 1) {
    const mkArrow = (dir, symbol) => {
      const btn = document.createElement("button");
      btn.className = "hero-nav-arrow";
      btn.type = "button";
      btn.setAttribute("aria-label", dir === "prev" ? "Sebelumnya" : "Berikutnya");
      btn.textContent = symbol;
      btn.style.cssText = `
        position:absolute; top:50%; ${dir==="prev"?"left:12px;":"right:12px;"}
        transform:translateY(-50%); z-index:5; width:38px; height:38px;
        border-radius:50%; border:1px solid rgba(255,255,255,.25);
        background:rgba(0,0,0,.45); color:#fff; font-size:18px; line-height:1;
        cursor:pointer; display:flex; align-items:center; justify-content:center;`;
      btn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        goTo(idx + (dir === "prev" ? -1 : 1));
        stopAutoplay(); startAutoplay();
      });
      return btn;
    };
    wrap.parentElement.style.position = wrap.parentElement.style.position || "relative";
    wrap.parentElement.appendChild(mkArrow("prev", "‹"));
    wrap.parentElement.appendChild(mkArrow("next", "›"));
  }

  let touchStartX = 0;
  wrap.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; stopAutoplay(); }, { passive: true });
  wrap.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) goTo(idx + (dx < 0 ? 1 : -1));
    startAutoplay();
  }, { passive: true });

  document.addEventListener("keydown", (e) => {
    const rect = wrap.getBoundingClientRect();
    const inView = rect.top < window.innerHeight && rect.bottom > 0;
    if (!inView) return;
    if (e.key === "ArrowLeft") { goTo(idx - 1); stopAutoplay(); startAutoplay(); }
    if (e.key === "ArrowRight") { goTo(idx + 1); stopAutoplay(); startAutoplay(); }
  });
}

async function logSearch(term, uid=null){
  try{
    await addDoc(collection(db,"search_logs"), { term, uid, searchedAt: serverTimestamp() });
  }catch(e){ console.warn("search log failed", e); }
}

function initSearch() {
  const input = document.getElementById("search-input");
  const resultsBox = document.getElementById("search-results");
  if (!input) return;
  let debounceTimer;

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const term = input.value.trim().toLowerCase();
    if (!term) { resultsBox.classList.remove("active"); resultsBox.innerHTML=""; return; }

    debounceTimer = setTimeout(() => {
      const matches = allPublishedVideos.filter(v => {
        return (v.title||"").toLowerCase().includes(term)
            || (v.description||"").toLowerCase().includes(term)
            || (v.category||"").toLowerCase().includes(term)
            || (v.tags||[]).some(t => t.toLowerCase().includes(term));
      }).slice(0, 8);

      resultsBox.innerHTML = matches.map(v => `
        <a class="search-result-item" href="watch.html?id=${v.id}">
          <img src="${buildThumbChain(v)[0]}" alt="">
          <div>
            <div style="font-size:.85rem">${escapeHtml(v.title)}</div>
            <div style="font-size:.72rem;color:var(--text-muted)">${escapeHtml(v.category||'')}</div>
          </div>
        </a>`).join("") || `<div style="padding:12px;color:var(--text-muted)">Tidak ditemukan</div>`;
      resultsBox.classList.add("active");
    }, 250);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      logSearch(input.value.trim());
      window.location.href = `search.html?q=${encodeURIComponent(input.value.trim())}`;
    }
  });

  document.addEventListener("click", (e) => {
    if (!resultsBox.contains(e.target) && e.target !== input) {
      resultsBox.classList.remove("active");
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  // 1) Terapkan dulu dari cache localStorage — INSTAN, tanpa nunggu Firestore.
  //    Ini yang bikin kedip nama/warna nyaris hilang buat pengunjung yang
  //    sudah pernah buka situs ini sebelumnya.
  applyCachedSiteSettings();

  // 2) Baru ambil data terbaru dari server, lalu terapkan ulang — supaya
  //    kalau ada perubahan nama/warna sejak kunjungan terakhir, tetap ikut
  //    ter-update (dan cache di localStorage ikut diperbarui untuk kunjungan
  //    berikutnya).
  await loadSiteSettings();
  applySiteSettings();

  initSearch();
  listenVideos(() => {
    renderHero();
    renderLatest();
    renderPopular();
    renderTrendingTags();
    renderTrendingCategories();
  });
});

export { computePopularScore, renderVideoCard, escapeHtml, PAGE_SIZE, buildThumbChain };
