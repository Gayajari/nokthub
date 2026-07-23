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

function renderVideoCard(v) {
  const url = `watch.html?id=${v.id}`;
  return `
    <a class="video-card" href="${url}">
      <div class="thumb-wrap">
        <img src="${v.thumbnail || 'https://via.placeholder.com/320x180/141416/9A9A9E?text=No+Image'}"
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
       style="background-image:url('${v.thumbnail}')">
      <div class="hero-info">
        <div class="eyebrow">Video Terbaru</div>
        <h1>${escapeHtml(v.title)}</h1>
        <p>${escapeHtml((v.description||"").slice(0,120))}</p>
        <span class="btn">Tonton Sekarang</span>
      </div>
    </a>`).join("");

  dotsWrap.innerHTML = slides.map((_,i) =>
    `<span data-i="${i}" class="${i===0?'active':''}"></span>`).join("");

  let idx = 0;
  const rotate = () => {
    idx = (idx + 1) % slides.length;
    wrap.querySelectorAll(".hero-slide").forEach((s,i)=> s.classList.toggle("active", i===idx));
    dotsWrap.querySelectorAll("span").forEach((s,i)=> s.classList.toggle("active", i===idx));
  };
  let timer = setInterval(rotate, 5000);
  dotsWrap.querySelectorAll("span").forEach(dot => {
    dot.addEventListener("click", () => {
      idx = parseInt(dot.dataset.i);
      wrap.querySelectorAll(".hero-slide").forEach((s,i)=> s.classList.toggle("active", i===idx));
      dotsWrap.querySelectorAll("span").forEach((s,i)=> s.classList.toggle("active", i===idx));
      clearInterval(timer);
      timer = setInterval(rotate, 5000);
    });
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
document.addEventListener("DOMContentLoaded", () => {
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
