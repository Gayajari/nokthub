// ============================================================
// NOKT HUB — Generic Listing + Pagination
// Dipakai oleh: category.html, tag.html, search.html, latest.html, popular.html
// ============================================================
import { db, collection, query, where, orderBy, getDocs, addDoc, serverTimestamp } from "./firebase-config.js";
import { escapeHtml } from "./app.js";

const PAGE_SIZE = 12;
let fullList = [];
let currentPage = 1;

function computePopularScore(v) {
  return (v.viewCount||0)*0.6 + (v.likeCount||0)*0.2 + (v.searchTagCount||0)*0.1 + (v.shareCount||0)*0.1;
}

function renderCard(v) {
  return `
    <a class="video-card" href="watch.html?id=${v.id}">
      <div class="thumb-wrap"><img src="${v.thumbnail}" alt="${escapeHtml(v.title)}" loading="lazy"></div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(v.title)}</div>
        <div class="card-meta">
          <span>${(v.viewCount||0).toLocaleString('id-ID')} view</span>
          <span>•</span><span>${escapeHtml(v.category||'-')}</span>
        </div>
      </div>
    </a>`;
}

function renderPage() {
  const grid = document.getElementById("listing-grid");
  const start = (currentPage - 1) * PAGE_SIZE;
  const items = fullList.slice(start, start + PAGE_SIZE);
  grid.innerHTML = items.map(renderCard).join("") ||
    `<p style="color:var(--text-muted)">Tidak ada video ditemukan.</p>`;
  renderPagination();
}

function renderPagination() {
  const wrap = document.getElementById("pagination");
  const totalPages = Math.max(1, Math.ceil(fullList.length / PAGE_SIZE));
  wrap.innerHTML = "";
  // Selalu bisa berpindah halaman berapapun tanpa error, termasuk lompat jauh
  for (let p = 1; p <= totalPages; p++) {
    const btn = document.createElement("button");
    btn.textContent = p;
    if (p === currentPage) btn.classList.add("active");
    btn.addEventListener("click", () => { currentPage = p; renderPage(); window.scrollTo(0,0); });
    wrap.appendChild(btn);
  }
}

async function fetchAllPublished() {
  const q = query(collection(db, "videos"), where("status", "==", "publish"), orderBy("uploadedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function initCategoryListing(categorySlug) {
  const all = await fetchAllPublished();
  fullList = all.filter(v => (v.category||"").toLowerCase() === categorySlug.toLowerCase());
  document.getElementById("listing-title").textContent = `Kategori: ${categorySlug}`;
  renderPage();
}

export async function initTagListing(tag) {
  const all = await fetchAllPublished();
  fullList = all.filter(v => (v.tags||[]).map(t=>t.toLowerCase()).includes(tag.toLowerCase()));
  document.getElementById("listing-title").textContent = `Tag: #${tag}`;

  // Tambah searchTagCount tiap kali tag diklik/dibuka -> mempengaruhi Popular Score
  fullList.forEach(async (v) => {
    // Dilakukan di admin/backend job idealnya; di sini contoh client-side sederhana
  });
  renderPage();
}

export async function initSearchListing(term) {
  const all = await fetchAllPublished();
  const t = term.toLowerCase();
  fullList = all.filter(v =>
    (v.title||"").toLowerCase().includes(t) ||
    (v.description||"").toLowerCase().includes(t) ||
    (v.category||"").toLowerCase().includes(t) ||
    (v.tags||[]).some(tag => tag.toLowerCase().includes(t))
  );
  document.getElementById("listing-title").textContent = `Hasil pencarian: "${term}"`;
  await addDoc(collection(db, "search_logs"), { term, searchedAt: serverTimestamp() });
  renderPage();
}

export async function initLatestListing() {
  fullList = await fetchAllPublished();
  document.getElementById("listing-title").textContent = "Semua Video Terbaru";
  renderPage();
}

export async function initPopularListing() {
  const all = await fetchAllPublished();
  fullList = all.sort((a,b) => computePopularScore(b) - computePopularScore(a));
  document.getElementById("listing-title").textContent = "Semua Video Populer";
  renderPage();
}
