// ============================================================
// NOKT HUB — Site (App Core + Kategori)
// ============================================================
// File ini GABUNGAN dari 3 file yang dulu terpisah:
//   - app.js        (logic halaman home, search, pengaturan situs)
//   - categories.js  (baris chip kategori di header, tampil di
//                      hampir semua halaman)
//   - listing.js     (listing generik: category/tag/search/latest/popular)
// Digabung supaya lebih sedikit file yang perlu dibuka-tutup saat
// maintenance -- fungsinya PERSIS SAMA seperti sebelumnya.
// ============================================================
import {
  db, collection, query, where, orderBy, limit, getDocs, doc, getDoc,
  addDoc, updateDoc, increment, serverTimestamp, onSnapshot
} from "./core.js";
import { resolveCategoryIcon, iconSvg, areIconsGloballyHidden } from "./core.js";

const PAGE_SIZE = 12;
let allPublishedVideos = [];
let currentPage = 1;

const DEFAULT_LOGO_URL = "https://i.ibb.co.com/nss27bKz/20260716-103634.png";

const PLACEHOLDER_THUMB = 'https://via.placeholder.com/320x180/141416/9A9A9E?text=No+Image';
let siteSettings = {};

// Link halaman tonton: domain/w/kode (video baru = kode 6 karakter,
// video lama = ID lamanya). Path absolut, jadi aman dipakai dari halaman mana pun.
function videoUrl(id) {
  return `/w/${id}`;
}

async function loadSiteSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "site"));
    siteSettings = snap.exists() ? snap.data() : {};
    try { localStorage.setItem("nokt_settings_cache", JSON.stringify(siteSettings)); } catch (e) {}
  } catch (e) { siteSettings = {}; }
}

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

function applySiteSettings() {
  const s = siteSettings;
  const name = s.siteName;

  if (name) {
    document.title = document.title.replace(/NOKT HUB/gi, name);
  }

  document.querySelectorAll(".site-brand-text").forEach(el => {
    if (name) el.textContent = name;
    el.style.visibility = "visible";
  });

  document.querySelectorAll(".site-name-inline").forEach(el => {
    if (name) el.textContent = name;
    el.style.visibility = "visible";
  });

  const contactEmail = s.contactEmail;
  document.querySelectorAll(".site-contact-email").forEach(el => {
    if (contactEmail) {
      el.textContent = contactEmail;
      el.href = "mailto:" + contactEmail;
    }
    el.style.visibility = "visible";
  });

  const dmcaEmail = s.dmcaEmail || s.contactEmail;
  document.querySelectorAll(".site-dmca-email").forEach(el => {
    if (dmcaEmail) {
      el.textContent = dmcaEmail;
      el.href = "mailto:" + dmcaEmail;
    }
    el.style.visibility = "visible";
  });

  const logoImg = document.getElementById("site-logo-img");
  if (logoImg) {
    logoImg.src = s.logoUrl || DEFAULT_LOGO_URL;
    if (name) logoImg.alt = `${name} logo`;
  }

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

  const faviconLink = document.getElementById("site-favicon");
  if (s.favicon && faviconLink) faviconLink.href = s.favicon;

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

// ============================================================
// RANTAI FALLBACK THUMBNAIL
// ============================================================
// Urutan prioritas SEKARANG (BARU: menambahkan thumbnail_supabase
// sebagai langkah ke-2, persis setelah ImgBB dan sebelum fallback
// lain -- sebelumnya field ini ada di data video tapi TIDAK PERNAH
// dipakai di halaman pengunjung sama sekali):
//   1. thumbnail            -> ImgBB (utama)
//   2. thumbnail_supabase   -> Supabase Storage (cadangan admin)
//   3. auto-thumb dari embedUrl (YouTube/Vimeo, kalau embed-nya cocok)
//   4. defaultThumbnail     -> "Thumbnail Cadangan Situs" di Pengaturan
//   5. PLACEHOLDER_THUMB    -> gambar generik terakhir, supaya tidak
//                              pernah benar-benar pecah/broken image
function buildThumbChain(v) {
  const chain = [];
  if (v.thumbnail) chain.push(normalizeThumbLink(v.thumbnail));
  if (v.thumbnail_supabase) chain.push(v.thumbnail_supabase);
  const auto = extractAutoThumb(v.embedUrl);
  if (auto) chain.push(auto);
  if (siteSettings.defaultThumbnail) chain.push(siteSettings.defaultThumbnail);
  chain.push(PLACEHOLDER_THUMB);
  return chain;
}

// BARU: rantai fallback disematkan LANGSUNG di elemen <img> lewat
// atribut data-thumb-chain (JSON), bukan dicari ulang dari videoId di
// array global allPublishedVideos. Sebelumnya cara lama ini gagal
// diam-diam di halaman listing (category/tag/search/latest/popular)
// karena allPublishedVideos cuma diisi di halaman home -- di halaman
// listing array itu kosong, jadi fallback tidak pernah ketemu videonya.
// Dengan disematkan di elemen sendiri, fallback selalu jalan di
// halaman mana pun tanpa bergantung pada state global.
window.__nokthubThumbFallback = function (imgEl) {
  let chain = [];
  try { chain = JSON.parse(imgEl.dataset.thumbChain || "[]"); } catch (e) { chain = []; }
  const step = parseInt(imgEl.dataset.fallbackStep || "0", 10) + 1;
  if (chain[step]) {
    imgEl.dataset.fallbackStep = String(step);
    imgEl.src = chain[step];
  } else {
    // Sudah di ujung rantai (bahkan PLACEHOLDER_THUMB pun gagal) --
    // matikan onerror supaya tidak looping.
    imgEl.onerror = null;
  }
};

// Helper bersama: bikin markup <img> thumbnail video lengkap dengan
// rantai fallback-nya, dipakai renderVideoCard & renderListingCard
// supaya perilakunya konsisten di semua halaman.
function thumbImgHtml(v, extraAttrs = "") {
  const chain = buildThumbChain(v);
  const chainAttr = JSON.stringify(chain).replace(/'/g, "&#39;").replace(/"/g, "&quot;");
  return `<img src="${chain[0]}" data-fallback-step="0" data-thumb-chain='${chainAttr}'
             onerror="window.__nokthubThumbFallback(this)"
             alt="${escapeHtml(v.title)}" loading="lazy" ${extraAttrs}>`;
}

function renderVideoCard(v) {
  const url = videoUrl(v.id);
  return `
    <a class="video-card" href="${url}">
      <div class="thumb-wrap">
        ${thumbImgHtml(v)}
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

// BARU: hero slider pakai CSS background-image, yang TIDAK punya
// event "onerror" bawaan seperti <img>. Supaya tetap kebagian rantai
// fallback yang sama (termasuk Supabase), setiap slide sekarang
// mem-preload gambarnya lewat objek Image() di JS -- kalau gagal,
// otomatis coba URL berikutnya di chain sebelum akhirnya diterapkan
// sebagai background-image.
function loadHeroSlideBackground(slideEl, chain) {
  let step = 0;
  const tryNext = () => {
    if (!chain[step]) return; // rantai habis, biarkan background kosong
    const probe = new Image();
    probe.onload = () => { slideEl.style.backgroundImage = `url('${chain[step]}')`; };
    probe.onerror = () => { step++; tryNext(); };
    probe.src = chain[step];
  };
  tryNext();
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
    <a class="hero-slide ${i===0?'active':''}" data-i="${i}" href="${videoUrl(v.id)}"
       style="transition:opacity .6s ease, transform .6s ease;">
      <div class="hero-info">
        <div class="eyebrow">Video Terbaru</div>
        <h1>${escapeHtml(v.title)}</h1>
        <p>${escapeHtml((v.description||"").slice(0,120))}</p>
        <span class="btn">Tonton Sekarang</span>
      </div>
    </a>`).join("");

  // Pasang background lewat preload+fallback, bukan langsung di string HTML.
  wrap.querySelectorAll(".hero-slide").forEach((slideEl, i) => {
    loadHeroSlideBackground(slideEl, buildThumbChain(slides[i]));
  });

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
        <a class="search-result-item" href="${videoUrl(v.id)}">
          ${thumbImgHtml(v)}
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

// ---------- Kategori (dulu categories.js) ----------
async function loadCategoryChips() {
  const row = document.getElementById("category-row");
  if (!row) return;

  const params = new URLSearchParams(window.location.search);
  const activeSlug = window.location.pathname.endsWith("category.html")
    ? (params.get("c") || "")
    : null;

  const hideIcons = areIconsGloballyHidden();

  const chipsHtml = [
    `<a href="index.html" class="catnav-chip${activeSlug === null ? " active" : ""}" data-cat="all">
      ${hideIcons ? "" : iconSvg("globe")} Semua
    </a>`
  ];

  try {
    const q = query(collection(db, "categories"), orderBy("name"));
    const snap = await getDocs(q);
    snap.forEach(d => {
      const cat = d.data();
      const isActive = activeSlug !== null && activeSlug === cat.slug;
      const iconId = resolveCategoryIcon(cat);
      const iconHtml = hideIcons ? "" : iconSvg(iconId);
      chipsHtml.push(`
        <a href="category.html?c=${encodeURIComponent(cat.slug)}" class="catnav-chip${isActive ? " active" : ""}" data-cat="${cat.slug}">
          ${iconHtml} ${escapeHtml(cat.name)}
        </a>`);
    });
  } catch (e) {
    console.warn("Gagal memuat kategori:", e);
  }

  row.innerHTML = chipsHtml.join("");
  applyScrollPosition(row, activeSlug);
}

function applyScrollPosition(row, activeSlug) {
  if (activeSlug === null) {
    row.scrollLeft = 0;
    requestAnimationFrame(() => { row.scrollLeft = 0; });
  } else {
    const activeChip = row.querySelector(".catnav-chip.active");
    if (activeChip) {
      activeChip.scrollIntoView({ behavior: "instant", inline: "center", block: "nearest" });
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  applyCachedSiteSettings();
  await loadSiteSettings();
  applySiteSettings();

  initSearch();
  loadCategoryChips();

  listenVideos(() => {
    renderHero();
    renderLatest();
    renderPopular();
    renderTrendingTags();
    renderTrendingCategories();
  });
});


// ---------- Listing generik (dulu listing.js) ----------
// Dipakai oleh category.html, tag.html, search.html, latest.html, popular.html
let listingFullList = [];
let listingCurrentPage = 1;
const LISTING_PAGE_SIZE = 12;

// BARU: sebelumnya fungsi ini langsung <img src="${v.thumbnail}">
// tanpa fallback SAMA SEKALI -- kalau ImgBB mati, gambar di halaman
// category/tag/search/latest/popular langsung pecah (broken image
// icon), beda dari renderVideoCard yang sudah punya rantai fallback.
// Sekarang dipakaikan thumbImgHtml() yang sama, supaya perilakunya
// identik dengan kartu video di homepage (ImgBB -> Supabase -> auto
// thumb -> thumbnail cadangan situs -> placeholder).
function renderListingCard(v) {
  return `
    <a class="video-card" href="${videoUrl(v.id)}">
      <div class="thumb-wrap">${thumbImgHtml(v)}</div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(v.title)}</div>
        <div class="card-meta">
          <span>${(v.viewCount||0).toLocaleString('id-ID')} view</span>
          <span>•</span><span>${escapeHtml(v.category||'-')}</span>
        </div>
      </div>
    </a>`;
}

function renderListingPage() {
  const grid = document.getElementById("listing-grid");
  const start = (listingCurrentPage - 1) * LISTING_PAGE_SIZE;
  const items = listingFullList.slice(start, start + LISTING_PAGE_SIZE);
  grid.innerHTML = items.map(renderListingCard).join("") ||
    `<p style="color:var(--text-muted)">Tidak ada video ditemukan.</p>`;
  renderListingPagination();
}

function renderListingPagination() {
  const wrap = document.getElementById("pagination");
  const totalPages = Math.max(1, Math.ceil(listingFullList.length / LISTING_PAGE_SIZE));
  wrap.innerHTML = "";
  for (let p = 1; p <= totalPages; p++) {
    const btn = document.createElement("button");
    btn.textContent = p;
    if (p === listingCurrentPage) btn.classList.add("active");
    btn.addEventListener("click", () => { listingCurrentPage = p; renderListingPage(); window.scrollTo(0,0); });
    wrap.appendChild(btn);
  }
}

async function fetchAllPublishedForListing() {
  const q = query(collection(db, "videos"), where("status", "==", "publish"), orderBy("uploadedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function initCategoryListing(categorySlug) {
  const all = await fetchAllPublishedForListing();
  listingFullList = all.filter(v => (v.category||"").toLowerCase() === categorySlug.toLowerCase());
  document.getElementById("listing-title").textContent = `Kategori: ${categorySlug}`;
  renderListingPage();
}

async function initTagListing(tag) {
  const all = await fetchAllPublishedForListing();
  listingFullList = all.filter(v => (v.tags||[]).map(t=>t.toLowerCase()).includes(tag.toLowerCase()));
  document.getElementById("listing-title").textContent = `Tag: #${tag}`;
  renderListingPage();
}

async function initSearchListing(term) {
  const all = await fetchAllPublishedForListing();
  const t = term.toLowerCase();
  listingFullList = all.filter(v =>
    (v.title||"").toLowerCase().includes(t) ||
    (v.description||"").toLowerCase().includes(t) ||
    (v.category||"").toLowerCase().includes(t) ||
    (v.tags||[]).some(tag => tag.toLowerCase().includes(t))
  );
  document.getElementById("listing-title").textContent = `Hasil pencarian: "${term}"`;
  await addDoc(collection(db, "search_logs"), { term, searchedAt: serverTimestamp() });
  renderListingPage();
}

async function initLatestListing() {
  listingFullList = await fetchAllPublishedForListing();
  document.getElementById("listing-title").textContent = "Semua Video Terbaru";
  renderListingPage();
}

async function initPopularListing() {
  const all = await fetchAllPublishedForListing();
  listingFullList = all.sort((a,b) => computePopularScore(b) - computePopularScore(a));
  document.getElementById("listing-title").textContent = "Semua Video Populer";
  renderListingPage();
}

export { videoUrl, computePopularScore, renderVideoCard, escapeHtml, PAGE_SIZE, buildThumbChain, initCategoryListing, initTagListing, initSearchListing, initLatestListing, initPopularListing };
