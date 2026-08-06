// ============================================================
// NOKT HUB — App Core (Home page logic)
// ============================================================
import {
  db, collection, query, where, orderBy, limit, getDocs, doc, getDoc,
  addDoc, updateDoc, increment, serverTimestamp, onSnapshot
} from "./firebase-config.js";

const PAGE_SIZE = 12;
let allPublishedVideos = []; // cache client-side untuk paginasi + search instan
let currentPage = 1;

const PLACEHOLDER_THUMB = 'https://via.placeholder.com/320x180/141416/9A9A9E?text=No+Image';
let siteSettings = {}; // dimuat sekali dari settings/site (dipakai untuk Thumbnail Default)

// ---------- Muat pengaturan situs (untuk Thumbnail Default, dll) ----------
async function loadSiteSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "site"));
    siteSettings = snap.exists() ? snap.data() : {};
  } catch (e) { siteSettings = {}; }
}

// ---------- Load semua video publish (realtime) ----------
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

// ---------- Popular Score ----------
// Popular Score = (View*0.6) + (Like*0.2) + (SearchTagCount*0.1) + (Share*0.1)
function computePopularScore(v) {
  return (v.viewCount || 0) * 0.6
       + (v.likeCount || 0) * 0.2
       + (v.searchTagCount || 0) * 0.1
       + (v.shareCount || 0) * 0.1;
}

// ---------- Thumbnail fallback berlapis ----------
// 1) Manual (v.thumbnail) -> 2) Otomatis dari metadata provider (saat ini: YouTube)
// -> 3) Thumbnail Default dari Website Settings -> 4) Placeholder bawaan.
// Kalau gambar yang dipilih gagal dimuat (link rusak), otomatis geser ke
// lapisan berikutnya lewat onerror, jadi tidak pernah ada gambar pecah.
function extractYoutubeAutoThumb(embedUrl) {
  if (!embedUrl) return null;
  const m = embedUrl.match(/youtu\.be\/([a-zA-Z0-9_-]+)/)
         || embedUrl.match(/[?&]v=([a-zA-Z0-9_-]+)/)
         || embedUrl.match(/embed\/([a-zA-Z0-9_-]+)/);
  return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : null;
}

function buildThumbChain(v) {
  const chain = [];
  if (v.thumbnail) chain.push(v.thumbnail);
  const auto = extractYoutubeAutoThumb(v.embedUrl);
  if (auto) chain.push(auto);
  if (siteSettings.defaultThumbnail) chain.push(siteSettings.defaultThumbnail);
  chain.push(PLACEHOLDER_THUMB);
  return chain;
}

// Dipanggil dari onerror inline di <img>, digantung ke window supaya bisa
// diakses dari atribut HTML inline.
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

// ---------- Render sections ----------
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

// ---------- Hero slider (video terbaru) ----------
// Ditambah: auto-rotate 6 detik, swipe mobile, tombol panah, transisi lebih
// halus, dan tetap aman kalau cuma ada 1 video (tanpa error).
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
       style="background-image:url('${v.thumbnail || buildThumbChain(v)[0]}');transition:opacity .6s ease, transform .6s ease;">
      <div class="hero-info">
        <div class="eyebrow">Video Terbaru</div>
        <h1>${escapeHtml(v.title)}</h1>
        <p>${escapeHtml((v.description||"").slice(0,120))}</p>
        <span class="btn">Tonton Sekarang</span>
      </div>
    </a>`).join("");

  dotsWrap.innerHTML = slides.map((_,i) =>
    `<span data-i="${i}" class="${i===0?'active':''}"></span>`).join("");

  // Bersihkan tombol panah lama (kalau ada dari render sebelumnya) sebelum bikin baru
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

  // Tombol panah kiri/kanan (dibuat via JS, style inline supaya tidak perlu ubah CSS)
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

  // Swipe mobile
  let touchStartX = 0;
  wrap.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; stopAutoplay(); }, { passive: true });
  wrap.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) goTo(idx + (dx < 0 ? 1 : -1));
    startAutoplay();
  }, { passive: true });

  // Panah keyboard (kiri/kanan), aktif saat hero dalam tampilan
  document.addEventListener("keydown", (e) => {
    const rect = wrap.getBoundingClientRect();
    const inView = rect.top < window.innerHeight && rect.bottom > 0;
    if (!inView) return;
    if (e.key === "ArrowLeft") { goTo(idx - 1); stopAutoplay(); startAutoplay(); }
    if (e.key === "ArrowRight") { goTo(idx + 1); stopAutoplay(); startAutoplay(); }
  });
}

// ---------- Realtime search (title, tag, category, description) ----------
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
          <img src="${v.thumbnail}" alt="">
          <div>
            <div style="font-size:.85rem">${escapeHtml(v.title)}</div>
            <div style="font-size:.72rem;color:var(--text-muted)">${escapeHtml(v.category||'')}</div>
          </div>
        </a>`).join("") || `<div style="padding:12px;color:var(--text-muted)">Tidak ditemukan</div>`;
      resultsBox.classList.add("active");
    }, 250); // debounce realtime tanpa reload
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

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", async () => {
  await loadSiteSettings();
  initSearch();
  listenVideos(() => {
    renderHero();
    renderLatest();
    renderPopular();
    renderTrendingTags();
    renderTrendingCategories();
  });
});

export { computePopularScore, renderVideoCard, escapeHtml, PAGE_SIZE };
