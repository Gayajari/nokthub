// ============================================================
// NOKT HUB — Watch Page Logic
// ============================================================
import {
  db, auth, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc,
  deleteDoc, query, where, orderBy, limit, increment, serverTimestamp,
  onAuthStateChanged, onSnapshot
} from "./firebase-config.js";
import { renderPlayer, trackResumePosition } from "./player.js";
import { escapeHtml, renderVideoCard, computePopularScore, buildThumbChain } from "./app.js";

const params = new URLSearchParams(window.location.search);
const videoId = params.get("id");
let currentUser = null;
let videoData = null;
let unsubscribeStats = null; // listener realtime view/like, dibersihkan saat pindah halaman

const MIN_WATCH_SECONDS = 10; // minimal detik nonton sebelum view dihitung
const VIEW_WINDOW_MS = 5 * 60 * 1000; // jeda 5 menit sebelum view dihitung ulang (sebelumnya 15 menit / 1 jam / 24 jam)
let viewCounted = false; // biar countView cuma jalan sekali per sesi nonton

// ---------- Ikon SVG (dipakai ulang untuk tombol like video & like/dislike komentar) ----------
const ICON_THUMB_UP = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>`;
const ICON_THUMB_DOWN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>`;

onAuthStateChanged(auth, (u) => {
  currentUser = u;
  checkLikeState();
  updateCommentBoxState();
  loadUserReactions(); // sinkronkan status like/dislike komentar & reply sesuai user yang login
});

// Aktifkan/nonaktifkan kotak komentar sesuai status login.
function updateCommentBoxState() {
  const input = document.getElementById("comment-input");
  const btn = document.getElementById("btn-comment");
  const hint = document.getElementById("comment-login-hint");
  if (!input || !btn) return;
  const loggedIn = !!currentUser;
  input.disabled = !loggedIn;
  input.placeholder = loggedIn ? "Tulis komentar..." : "Tulis komentar...";
  if (hint) hint.style.display = loggedIn ? "none" : "inline";
  // PENYEMPURNAAN: tombol kirim (sekarang ikon SVG bulat) punya 2 syarat
  // aktif -- harus login DAN teks tidak kosong. Textarea cukup dikontrol
  // oleh login saja seperti semula; state disabled tombol didelegasikan
  // ke refreshSendButtonState() biar satu sumber kebenaran (lihat di bawah).
  refreshSendButtonState();
}

// ---------- State tombol kirim (ikon SVG bulat) ----------
// Tombol AKTIF hanya kalau: user sudah login DAN teks komentar tidak
// kosong/spasi doang. Dipanggil tiap kali status login berubah
// (updateCommentBoxState) maupun tiap user mengetik (listener "input" di
// setupCompactCommentLayout). Murni UI state -- tidak menyentuh Firestore
// atau logic kirim komentar itu sendiri.
function refreshSendButtonState() {
  const input = document.getElementById("comment-input");
  const btn = document.getElementById("btn-comment");
  if (!input || !btn) return;
  const loggedIn = !!currentUser;
  const hasText = input.value.trim().length > 0;
  btn.disabled = !loggedIn || !hasText;
}

async function loadVideo() {
  if (!videoId) return;
  const ref = doc(db, "videos", videoId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    document.getElementById("video-title").textContent = "Video tidak ditemukan";
    return;
  }
  videoData = { id: snap.id, ...snap.data() };
  renderVideoInfo();
  updateCommentBoxState();
  listenVideoStats();
  await loadRelated();
  listenComments();
  checkLikeState();
}

function renderVideoInfo() {
  const v = videoData;
  document.title = `${v.title} — NOKT HUB`;
  document.getElementById("page-title").textContent = `${v.title} — NOKT HUB`;
  document.getElementById("meta-desc").setAttribute("content", v.seoDescription || v.description || "");
  document.getElementById("og-title").setAttribute("content", v.seoTitle || v.title);
  document.getElementById("og-desc").setAttribute("content", v.description || "");
  document.getElementById("og-image").setAttribute("content", v.thumbnail || "");
  document.getElementById("canonical-link").setAttribute("href", `${location.origin}/watch.html?id=${v.id}`);

  document.getElementById("json-ld").textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "name": v.title,
    "description": v.description,
    "thumbnailUrl": v.thumbnail,
    "uploadDate": v.uploadedAt?.toDate ? v.uploadedAt.toDate().toISOString() : undefined
  });

  document.getElementById("video-title").textContent = v.title;

  const descEl = document.getElementById("video-desc");
  if (v.description) {
    descEl.style.display = "";
    setupCollapsibleDescription(descEl, v.description);
  } else {
    // Gak ada deskripsi -> sembunyikan total, gak nyisain ruang kosong.
    descEl.style.display = "none";
    descEl.textContent = "";
    const oldToggle = document.getElementById("btn-toggle-desc");
    if (oldToggle) oldToggle.remove();
  }

  document.getElementById("stat-views").textContent = `${(v.viewCount||0).toLocaleString('id-ID')} view`;
  document.getElementById("stat-likes").textContent = `${(v.likeCount||0).toLocaleString('id-ID')} like`;
  document.getElementById("stat-date").textContent = v.uploadedAt?.toDate
    ? v.uploadedAt.toDate().toLocaleDateString('id-ID') : "";

  const catEl = document.getElementById("video-category");
  if (v.category) {
    catEl.innerHTML = `<a class="cat-chip" href="category.html?c=${encodeURIComponent(v.category)}" style="font-size:.75rem;opacity:.7;padding:3px 10px">${escapeHtml(v.category)}</a>`;
    catEl.style.display = "";
  } else {
    catEl.innerHTML = "";
    catEl.style.display = "none";
  }

  document.getElementById("video-tags").innerHTML = (v.tags||[])
    .map(t => `<a class="tag-chip" href="tag.html?t=${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`).join("");

  const resumeKey = `nokt_resume_${v.id}`;
  const resumeAt = currentUser ? null : parseInt(localStorage.getItem(resumeKey) || "0");

  const container = document.getElementById("player-container");
  const el = renderPlayer(container, v.embedUrl, { resumeAt });

  trackResumePosition(el, (t) => {
    localStorage.setItem(resumeKey, t);
    if (currentUser) saveHistory(t);
    if (!viewCounted && t >= MIN_WATCH_SECONDS) {
      viewCounted = true;
      countView();
    }
  });
}

// ---------- Realtime stats (view/like) tanpa reload ----------
function listenVideoStats() {
  if (unsubscribeStats) unsubscribeStats();
  unsubscribeStats = onSnapshot(doc(db, "videos", videoId), (snap) => {
    if (!snap.exists()) return;
    const d = snap.data();
    videoData = { id: videoId, ...d };
    document.getElementById("stat-views").textContent = `${(d.viewCount||0).toLocaleString('id-ID')} view`;
    document.getElementById("stat-likes").textContent = `${(d.likeCount||0).toLocaleString('id-ID')} like`;
  }, (err) => {
    console.error("Gagal mendengarkan statistik video:", err.message);
  });
}
window.addEventListener("beforeunload", () => { if (unsubscribeStats) unsubscribeStats(); });

async function saveHistory(position) {
  if (!currentUser) return;
  const ref = doc(db, "history", `${currentUser.uid}_${videoId}`);
  await setDoc(ref, {
    uid: currentUser.uid, videoId, lastPosition: position, watchedAt: serverTimestamp()
  }, { merge: true });
}

// ---------- View counting ----------
async function countView() {
  try {
    const anonId = getAnonId();
    const uidOrAnon = currentUser ? currentUser.uid : anonId;
    const viewDocId = `${videoId}_${uidOrAnon}`;
    const ref = doc(db, "views", viewDocId);
    const snap = await getDoc(ref);
    const now = Date.now();
    if (snap.exists()) {
      const last = snap.data().viewedAt?.toMillis?.() || 0;
      if (now - last < VIEW_WINDOW_MS) return;
    }
    await setDoc(ref, { videoId, uid: uidOrAnon, viewedAt: serverTimestamp() });
    await updateDoc(doc(db, "videos", videoId), { viewCount: increment(1) });
  } catch (err) {
    console.error("Gagal menghitung view:", err.message);
  }
}

function getAnonId() {
  let id = localStorage.getItem("nokt_anon_id");
  if (!id) {
    id = "anon_" + Math.random().toString(36).slice(2);
    localStorage.setItem("nokt_anon_id", id);
  }
  return id;
}

// ---------- Like video ----------
async function checkLikeState() {
  const btn = document.getElementById("btn-like");
  if (!btn) return;
  if (!currentUser || !videoId) { btn.classList.remove("is-active"); return; }
  try {
    const snap = await getDoc(doc(db, "likes", `${videoId}_${currentUser.uid}`));
    btn.classList.toggle("is-active", snap.exists());
  } catch (err) {
    console.error("Gagal memeriksa status like:", err.message);
  }
}

document.getElementById("btn-like").addEventListener("click", async () => {
  if (!currentUser) { window.location.href = "login.html"; return; }
  const btn = document.getElementById("btn-like");
  try {
    const likeRef = doc(db, "likes", `${videoId}_${currentUser.uid}`);
    const snap = await getDoc(likeRef);
    if (snap.exists()) {
      await deleteDoc(likeRef);
      await updateDoc(doc(db, "videos", videoId), { likeCount: increment(-1) });
      btn.classList.remove("is-active");
    } else {
      await setDoc(likeRef, { videoId, uid: currentUser.uid });
      await updateDoc(doc(db, "videos", videoId), { likeCount: increment(1) });
      btn.classList.add("is-active");
    }
  } catch (err) {
    console.error("Gagal menyimpan like:", err.message);
  }
});

// ---------- Share ----------
document.querySelectorAll("[data-share]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const url = window.location.href;
    const platform = btn.dataset.share;
    if (platform === "copy") {
      await navigator.clipboard.writeText(url);
      btn.textContent = "Tersalin!";
      setTimeout(() => btn.textContent = "Copy Link", 1500);
    } else if (platform === "whatsapp") {
      window.open(`https://wa.me/?text=${encodeURIComponent(url)}`, "_blank");
    } else if (platform === "telegram") {
      window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}`, "_blank");
    } else if (platform === "facebook") {
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, "_blank");
    } else if (platform === "twitter") {
      window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}`, "_blank");
    } else if (platform === "native" && navigator.share) {
      navigator.share({ title: videoData?.title, url });
    }
    try {
      await addDoc(collection(db, "shares"), {
        videoId, uid: currentUser?.uid || null, platform, sharedAt: serverTimestamp()
      });
      await updateDoc(doc(db, "videos", videoId), { shareCount: increment(1) });
    } catch (err) {
      console.error("Gagal mencatat share:", err.message);
    }
  });
});

// ---------- Related videos ----------
// BASE ALGORITHM (dipertahankan): kandidat utama tetap dari query lama —
// category == videoData.category, status == "publish". Query ini TIDAK diganti.
//
// PENYEMPURNAAN yang ditambahkan (kompatibel, bukan pengganti):
//   1. Pool kandidat diperbesar jadi 24 (bukan langsung 6) sebagai bahan ranking & rotation.
//   2. Fallback ke tag (array-contains-any) & video terbaru kalau kandidat kategori kurang
//      (hanya jalan kalau kandidat memang kurang -- tidak ada query tambahan yang tidak perlu).
//   3. Ranking relevansi: kategori cocok + overlap tag + computePopularScore (skor lama di
//      app.js dipakai ulang, bukan bikin skor baru dari nol) + bonus kecil video baru.
//   4. Rotation/exposure: 2 slot teratas = paling relevan (stabil, prioritas utama tetap
//      dari algoritma lama). 4 slot sisanya dipilih weighted-random dari kandidat berikutnya,
//      seed per sesi+video -> related tetap sama selama 1 kunjungan, berganti di kunjungan lain.
//   5. Bebas duplikat & exclude video aktif dijaga di satu titik (Map "seen") sebelum masuk
//      scoring/rotation, jadi tidak mungkin video yang sedang ditonton lolos ke slot manapun.
const RELATED_SHOW_COUNT = 6;
const RELATED_FIXED_TOP = 2;
const RELATED_CANDIDATE_POOL = 24;
let currentRelatedItems = [];

function seededRandom(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let seed = (h ^= h >>> 16) >>> 0;
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Token rotation per tab (sessionStorage) -> urutan konsisten selama sesi,
// otomatis beda di sesi/kunjungan berikutnya.
function getRotationSeed() {
  let token = sessionStorage.getItem("nokt_related_rotation");
  if (!token) {
    token = Math.random().toString(36).slice(2);
    sessionStorage.setItem("nokt_related_rotation", token);
  }
  return token;
}

function computeRelatedScore(candidate, current) {
  const currentTags = new Set(current.tags || []);
  const tagOverlap = (candidate.tags || []).filter(t => currentTags.has(t)).length;
  const sameCategory = current.category && candidate.category === current.category ? 1 : 0;
  const ageDays = candidate.uploadedAt?.seconds
    ? (Date.now() / 1000 - candidate.uploadedAt.seconds) / 86400 : 999;
  const recencyBonus = Math.max(0, 20 - ageDays) * 0.5;
  return (sameCategory * 50) + (tagOverlap * 30) + computePopularScore(candidate) + recencyBonus;
}

// Weighted random tanpa pengembalian -- skor tinggi lebih besar peluangnya
// terpilih, tapi bukan mutlak. Di sinilah "exposure" video lain terjadi.
function weightedPickWithoutReplacement(items, count, rng) {
  const pool = items.map(v => ({ v, w: Math.max(v.__relatedScore, 0.01) }));
  const picked = [];
  while (picked.length < count && pool.length) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let r = rng() * total, i = 0;
    for (; i < pool.length; i++) { r -= pool[i].w; if (r <= 0) break; }
    const idx = Math.min(i, pool.length - 1);
    picked.push(pool[idx].v);
    pool.splice(idx, 1);
  }
  return picked;
}

async function fetchRelatedCandidates() {
  const seen = new Map();
  const addAll = (arr) => arr.forEach(d => { if (d.id !== videoId && !seen.has(d.id)) seen.set(d.id, d); });

  // 1) QUERY LAMA (dipertahankan apa adanya): kategori sama.
  if (videoData.category) {
    const qCategory = query(
      collection(db, "videos"),
      where("status", "==", "publish"),
      where("category", "==", videoData.category),
      limit(RELATED_CANDIDATE_POOL)
    );
    addAll((await getDocs(qCategory)).docs.map(d => ({ id: d.id, ...d.data() })));
  }

  // 2) FALLBACK tag (dipakai hanya kalau kandidat dari kategori masih kurang)
  // CATATAN: query ini butuh composite index baru di Firestore
  // (status == + tags array-contains-any). Kalau muncul error index saat
  // testing, klik link yang diberikan Firestore di console untuk membuatnya.
  if (seen.size < RELATED_CANDIDATE_POOL && (videoData.tags || []).length) {
    const qTags = query(
      collection(db, "videos"),
      where("status", "==", "publish"),
      where("tags", "array-contains-any", videoData.tags.slice(0, 10)),
      limit(RELATED_CANDIDATE_POOL)
    );
    addAll((await getDocs(qTags)).docs.map(d => ({ id: d.id, ...d.data() })));
  }

  // 3) FALLBACK video terbaru (hanya kalau kandidat masih kurang dari jumlah tampil)
  if (seen.size < RELATED_SHOW_COUNT) {
    const qFallback = query(
      collection(db, "videos"),
      where("status", "==", "publish"),
      orderBy("uploadedAt", "desc"),
      limit(RELATED_CANDIDATE_POOL)
    );
    addAll((await getDocs(qFallback)).docs.map(d => ({ id: d.id, ...d.data() })));
  }

  return [...seen.values()];
}

window.__nokthubRelatedThumbFallback = function (imgEl, id) {
  const v = currentRelatedItems.find(x => x.id === id);
  if (!v) { imgEl.src = 'https://via.placeholder.com/320x180/141416/9A9A9E?text=No+Image'; return; }
  const chain = buildThumbChain(v);
  const step = parseInt(imgEl.dataset.fallbackStep || "0", 10) + 1;
  if (chain[step]) { imgEl.dataset.fallbackStep = step; imgEl.src = chain[step]; }
};

async function loadRelated() {
  const wrap = document.getElementById("related-list");
  const candidates = await fetchRelatedCandidates();
  candidates.forEach(v => { v.__relatedScore = computeRelatedScore(v, videoData); });
  candidates.sort((a, b) => b.__relatedScore - a.__relatedScore);

  // Slot 1-2: hasil algoritma relevansi existing, dipertahankan apa adanya.
  const fixedTop = candidates.slice(0, RELATED_FIXED_TOP);
  // Slot 3 dst: rotation/exposure bergilir dari sisa kandidat.
  const rotationPool = candidates.slice(RELATED_FIXED_TOP);
  const rng = seededRandom(getRotationSeed() + "_" + videoId);
  const rotationPicks = weightedPickWithoutReplacement(
    rotationPool, Math.max(RELATED_SHOW_COUNT - fixedTop.length, 0), rng
  );

  currentRelatedItems = [...fixedTop, ...rotationPicks].slice(0, RELATED_SHOW_COUNT);

  wrap.innerHTML = currentRelatedItems.map(v => `
    <a href="watch.html?id=${v.id}" style="display:flex;gap:10px;text-decoration:none;color:inherit">
      <img src="${buildThumbChain(v)[0]}" data-fallback-step="0"
           onerror="window.__nokthubRelatedThumbFallback(this, '${v.id}')"
           style="width:120px;aspect-ratio:16/9;object-fit:cover;border-radius:6px" loading="lazy">
      <div>
        <div style="font-size:.85rem;font-weight:600;line-height:1.3">${escapeHtml(v.title)}</div>
        <div style="font-size:.72rem;color:var(--text-muted)">${(v.viewCount||0).toLocaleString('id-ID')} view</div>
      </div>
    </a>`).join("") || `<p style="color:var(--text-muted)">Belum ada video terkait</p>`;
}

// ---------- Comments ----------
let allComments = [];
let userReactions = {};        // { [commentOrReplyId]: "like" | "dislike" }
let commentSortOrder = "desc";
let commentDisplayLimit = 8;
const COMMENT_BATCH_SIZE = 8;
let unsubscribeComments = null;
const pendingReactions = new Set();
let activeReplyBox = null;         // id komentar/reply yang lagi dibalas (kotak reply terbuka)
const expandedReplies = new Set(); // id komentar top-level yang balasannya lagi ditampilkan
const replyDisplayLimits = {};     // { [commentId]: berapa reply yang ditampilkan } -- biar reply banyak gak sekaligus dirender semua
const REPLY_BATCH_SIZE = 5;

function listenComments() {
  if (unsubscribeComments) unsubscribeComments();
  const list = document.getElementById("comment-list");
  const q = query(
    collection(db, "comments"),
    where("videoId", "==", videoId),
    orderBy("createdAt", commentSortOrder)
  );
  unsubscribeComments = onSnapshot(q, (snap) => {
    allComments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCommentsList();
  }, (err) => {
    console.error("Gagal memuat komentar:", err.code, err.message);
    list.innerHTML = `<p style="color:var(--text-muted)">Gagal memuat komentar.<br>
      <span style="font-size:.75rem;opacity:.8">Kode error: ${escapeHtml(err.code || '-')}<br>${escapeHtml(err.message || '')}</span></p>`;
  });
}
window.addEventListener("beforeunload", () => { if (unsubscribeComments) unsubscribeComments(); });
window.addEventListener("beforeunload", () => { stopPreviewRotation(); }); // pastikan timer rotation ikut dibersihkan

function renderCommentsList() {
  const list = document.getElementById("comment-list");
  const topLevel = allComments.filter(c => !c.parentId);
  const visible = topLevel.slice(0, commentDisplayLimit);

  list.innerHTML = visible.map(c => renderComment(c, allComments)).join("")
    || `<p style="color:var(--text-muted)">Belum ada komentar.<br>Tulis komentar pertama...</p>`;

  if (topLevel.length > commentDisplayLimit) {
    const sisa = topLevel.length - commentDisplayLimit;
    list.innerHTML += `
      <button class="share-btn" id="btn-load-more-comments" style="width:100%;margin-top:10px">
        Muat lebih banyak (${sisa} lagi)
      </button>`;
  }

  // Comment count & preview: reuse topLevel yang sudah dihitung di atas,
  // TIDAK ada query tambahan ke Firestore.
  updateCommentToggleHeader(topLevel);

  // Reposisi ulang kolom komentar kalau lagi zoom aktif dan daftar komentar
  // baru saja berubah tinggi (misal abis kirim komentar baru).
  if (commentZoomController && commentZoomController.isActive()) {
    commentZoomController.reposition();
  }

  // Kalau sedang expanded, konten tingginya mungkin berubah (komentar baru,
  // reply baru dibuka, dst) -- sinkronkan ulang max-height wrapper supaya
  // tidak ada bagian yang terpotong. Aman dipanggil walau belum expanded
  // karena fungsi ini no-op saat collapsed.
  if (typeof syncCommentExpandHeight === "function") syncCommentExpandHeight();
}

document.getElementById("comment-list").addEventListener("click", (e) => {
  if (e.target.id === "btn-load-more-comments") {
    commentDisplayLimit += COMMENT_BATCH_SIZE;
    renderCommentsList();
  }
});

document.querySelectorAll("#sort-newest, #sort-oldest").forEach(btn => {
  btn.addEventListener("click", () => {
    commentSortOrder = btn.dataset.sort;
    commentDisplayLimit = COMMENT_BATCH_SIZE;
    document.querySelectorAll("#sort-newest, #sort-oldest").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    listenComments();
  });
});
document.getElementById("sort-newest").classList.add("active");

// Diefisienkan: sebelumnya 1 getDoc per komentar (bisa puluhan read tiap buka
// halaman). Sekarang cukup SATU query terhadap comment_reactions milik user
// ini untuk video ini (reaction doc kini menyimpan field videoId supaya bisa
// difilter langsung tanpa perlu tahu daftar commentId dulu).
async function loadUserReactions() {
  userReactions = {};
  if (!currentUser) { renderCommentsList(); return; }
  try {
    const q = query(
      collection(db, "comment_reactions"),
      where("uid", "==", currentUser.uid),
      where("videoId", "==", videoId)
    );
    const snap = await getDocs(q);
    snap.forEach(d => { userReactions[d.data().commentId] = d.data().type; });
  } catch (err) {
    console.error("Gagal memuat reaksi komentar:", err.message);
  }
  renderCommentsList();
}

function formatCommentDate(ts) {
  return ts?.toDate ? ts.toDate().toLocaleDateString('id-ID') : "";
}

function renderReactionRow(item, myReaction) {
  const likeActive = myReaction === "like" ? "is-active" : "";
  const dislikeActive = myReaction === "dislike" ? "is-active" : "";
  return `
    <span class="comment-react ${likeActive}" data-react="like" data-cid="${item.id}">${ICON_THUMB_UP} ${item.likeCount||0}</span>
    <span class="comment-react ${dislikeActive}" data-react="dislike" data-cid="${item.id}">${ICON_THUMB_DOWN} ${item.dislikeCount||0}</span>`;
}

// Kotak balas ini SELALU nempel di parent komentar top-level (parentId),
// walau yang dibalas adalah sebuah reply -- sesuai aturan "reply cuma 1
// tingkat". mentionName cuma dipakai buat isi awal teks "@Nama ".
function renderReplyBox(parentId, mentionName) {
  if (activeReplyBox !== parentId) return "";
  const mention = mentionName ? `@${escapeHtml(mentionName)} ` : "";
  return `
    <div class="reply-box" style="margin-top:8px">
      <textarea class="reply-input" data-parent="${parentId}"
        style="width:100%;min-height:36px;resize:vertical;background:var(--surface,#151517);color:inherit;border:1px solid var(--border,#2a2a2d);border-radius:6px;padding:6px 8px;font-size:.8rem"
        placeholder="Tulis balasan...">${mention}</textarea>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button class="btn btn-send-reply" data-parent="${parentId}" style="font-size:.75rem;padding:4px 12px">Kirim</button>
        <button class="share-btn btn-cancel-reply" data-parent="${parentId}" style="font-size:.75rem;padding:4px 12px">Batal</button>
      </div>
    </div>`;
}

function renderComment(c, all) {
  const replies = all.filter(r => r.parentId === c.id);
  const isOwner = currentUser && currentUser.uid === c.uid;
  const myReaction = userReactions[c.id];
  const isExpanded = expandedReplies.has(c.id);
  const replyLimit = replyDisplayLimits[c.id] || REPLY_BATCH_SIZE;
  const visibleReplies = replies.slice(0, replyLimit);
  const sisaReplies = replies.length - visibleReplies.length;

  // word-break/overflow-wrap: jaga nama/isi komentar yang panjang (link
  // tanpa spasi, username panjang, dll) supaya tetap membungkus ke baris
  // berikutnya, gak bikin halaman scroll ke samping di HP.
  const wrapStyle = "overflow-wrap:anywhere;word-break:break-word";

  return `
    <div class="comment-item" style="max-width:100%">
      <img src="${c.userPhoto || 'https://via.placeholder.com/34'}" alt="" style="flex-shrink:0">
      <div style="flex:1;min-width:0">
        <div style="font-size:.85rem;font-weight:600;${wrapStyle}">${escapeHtml(c.userName || 'User')}
          <span style="font-weight:400;color:var(--text-muted);font-size:.72rem">· ${formatCommentDate(c.createdAt)}</span>
        </div>
        <div style="font-size:.85rem;margin:4px 0;${wrapStyle}">${escapeHtml(c.text)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:14px;font-size:.72rem;color:var(--text-muted);align-items:center">
          ${renderReactionRow(c, myReaction)}
          <span style="cursor:pointer" data-reply="${c.id}" data-reply-name="${escapeHtml(c.userName||'User')}">Balas</span>
          ${isOwner ? `<span style="cursor:pointer" data-del="${c.id}">Hapus</span>` : ""}
        </div>
        ${renderReplyBox(c.id, c.userName)}
        ${replies.length ? `
          <div style="margin-top:6px">
            <span class="btn-toggle-replies" data-toggle-replies="${c.id}" style="font-size:.72rem;color:var(--accent,#ff7a00);cursor:pointer;font-weight:600">
              ${isExpanded ? "Sembunyikan balasan" : `Lihat ${replies.length} balasan`}
            </span>
          </div>` : ""}
        ${isExpanded ? visibleReplies.map(r => {
          const rReaction = userReactions[r.id];
          const rIsOwner = currentUser && currentUser.uid === r.uid;
          return `
          <div style="margin-top:8px;padding-left:14px;border-left:2px solid var(--border);max-width:100%">
            <div style="font-size:.8rem;font-weight:600;${wrapStyle}">${escapeHtml(r.userName)}
              <span style="font-weight:400;color:var(--text-muted);font-size:.7rem">· ${formatCommentDate(r.createdAt)}</span>
            </div>
            <div style="font-size:.8rem;${wrapStyle}">${escapeHtml(r.text)}</div>
            <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:.7rem;color:var(--text-muted);margin-top:4px;align-items:center">
              ${renderReactionRow(r, rReaction)}
              <span style="cursor:pointer" data-reply="${c.id}" data-reply-name="${escapeHtml(r.userName||'User')}">Balas</span>
              ${rIsOwner ? `<span style="cursor:pointer" data-del="${r.id}">Hapus</span>` : ""}
            </div>
          </div>`;
        }).join("") : ""}
        ${isExpanded && sisaReplies > 0 ? `
          <span class="btn-load-more-replies" data-more-replies="${c.id}"
            style="display:inline-block;margin-top:6px;font-size:.72rem;color:var(--text-muted);cursor:pointer;text-decoration:underline">
            Lihat balasan lainnya (${sisaReplies})
          </span>` : ""}
      </div>
    </div>`;
}

// ---------- Kirim komentar ----------
// PENTING: tombol Kirim dipasangi "mousedown preventDefault" (lihat di bawah,
// di dalam setupCommentFocusZoom) supaya textarea TIDAK blur duluan saat
// tombol ini ditekan. Sebelumnya urutan kejadian saat user tap "Kirim" itu:
//   1. mousedown di tombol -> browser pindahkan fokus -> textarea blur
//   2. blur listener jalan -> deactivate() -> layout balik ke posisi awal
//      (tombol Kirim ikut pindah posisi)
//   3. click event baru mau nembak ke koordinat lama -> tombol udah gak
//      ada di situ lagi -> klik "meleset", komentar gak terkirim
//   4. user harus tap sekali lagi baru kekirim
// Dengan preventDefault di mousedown, fokus TETAP di textarea selama proses
// kirim, tombol gak ikut pindah, klik langsung kena -> sekali tap langsung kirim.
document.getElementById("btn-comment").addEventListener("click", async () => {
  if (!currentUser) { window.location.href = "login.html"; return; }
  const input = document.getElementById("comment-input");
  const btn = document.getElementById("btn-comment");
  const text = input.value.trim();
  if (!text) return;

  // PENYEMPURNAAN: dulu feedback "lagi ngirim" ditulis lewat
  // btn.textContent = "Mengirim..." lalu balik ke "Kirim". Sekarang tombol
  // adalah ikon SVG (pesawat kertas) yang isinya tidak diganti-ganti --
  // feedback "lagi ngirim" & "sukses kirim" dipindah ke class CSS
  // (is-sending / sent) yang meredupkan / memberi micro-pulse ke ikonnya.
  btn.disabled = true;
  btn.classList.add("is-sending");
  try {
    await addDoc(collection(db, "comments"), {
      videoId, uid: currentUser.uid,
      userName: currentUser.displayName || "User",
      userPhoto: currentUser.photoURL || "",
      text, parentId: null, likeCount: 0, dislikeCount: 0,
      createdAt: serverTimestamp()
    });
    input.value = "";
    resetTextareaHeight(input); // balik ke tinggi ringkas, gak nyisa tinggi lama
    // Baru sekarang tutup mode zoom & keyboard, SETELAH komentar sukses
    // terkirim -> textarea di-blur manual, blur listener yang menutup
    // overlay jalan seperti biasa, dan user langsung lihat komentar
    // barunya di daftar (posisi udah balik normal).
    input.blur();
    // Micro-interaction sukses kirim: pulse singkat pada ikon SVG.
    btn.classList.remove("is-sending");
    btn.classList.add("sent");
    setTimeout(() => btn.classList.remove("sent"), 400);
  } catch (err) {
    console.error("Gagal mengirim komentar:", err.message);
    alert("Komentar gagal terkirim. Coba lagi sebentar lagi.\n(" + err.message + ")");
    // Gagal kirim -> jangan ditutup, biarkan user coba lagi tanpa harus fokus ulang.
    btn.classList.remove("is-sending");
  } finally {
    // Teks sudah dikosongkan (sukses) atau masih ada (gagal) -- baik pun,
    // refreshSendButtonState() yang menentukan aktif/tidaknya tombol
    // berikutnya berdasarkan status login + isi textarea saat ini.
    refreshSendButtonState();
  }
});

// Satu listener untuk: hapus komentar/reply, buka/tutup kotak balas, kirim
// balasan, expand/collapse daftar balasan, dan reaksi like/dislike
// (komentar maupun reply -- keduanya sama-sama dokumen di koleksi
// "comments" jadi dipakaikan logika yang sama persis).
document.getElementById("comment-list").addEventListener("click", async (e) => {
  // --- Hapus komentar / reply ---
  const delId = e.target.dataset.del;
  if (delId) {
    await deleteDoc(doc(db, "comments", delId));
    return;
  }

  // --- Buka/tutup kotak balas ---
  const replyId = e.target.dataset.reply;
  if (replyId) {
    if (!currentUser) { window.location.href = "login.html"; return; }
    activeReplyBox = activeReplyBox === replyId ? null : replyId;
    renderCommentsList();
    return;
  }

  // --- Batal balas ---
  if (e.target.classList.contains("btn-cancel-reply")) {
    activeReplyBox = null;
    renderCommentsList();
    return;
  }

  // --- Tampilkan / sembunyikan daftar balasan ---
  const toggleId = e.target.dataset.toggleReplies;
  if (toggleId) {
    if (expandedReplies.has(toggleId)) {
      expandedReplies.delete(toggleId);
      delete replyDisplayLimits[toggleId]; // balik ke batas awal kalau ditutup lagi
    } else {
      expandedReplies.add(toggleId);
    }
    renderCommentsList();
    return;
  }

  // --- Muat balasan lainnya (pagination reply) ---
  const moreRepliesId = e.target.dataset.moreReplies;
  if (moreRepliesId) {
    replyDisplayLimits[moreRepliesId] = (replyDisplayLimits[moreRepliesId] || REPLY_BATCH_SIZE) + REPLY_BATCH_SIZE;
    renderCommentsList();
    return;
  }

  // --- Kirim balasan ---
  if (e.target.classList.contains("btn-send-reply")) {
    if (!currentUser) { window.location.href = "login.html"; return; }
    const parentId = e.target.dataset.parent;
    const box = document.querySelector(`.reply-input[data-parent="${parentId}"]`);
    const text = box ? box.value.trim() : "";
    if (!text) return;
    e.target.disabled = true;
    try {
      await addDoc(collection(db, "comments"), {
        videoId, uid: currentUser.uid,
        userName: currentUser.displayName || "User",
        userPhoto: currentUser.photoURL || "",
        text, parentId, likeCount: 0, dislikeCount: 0,
        createdAt: serverTimestamp()
      });
      activeReplyBox = null;
      expandedReplies.add(parentId); // biar balasan baru langsung kelihatan
    } catch (err) {
      console.error("Gagal mengirim balasan:", err.message);
      alert("Balasan gagal terkirim. Coba lagi.");
    } finally {
      e.target.disabled = false;
    }
    return;
  }

  // --- Reaksi like/dislike (komentar maupun reply) ---
  const reactEl = e.target.closest("[data-react]");
  if (reactEl) {
    if (!currentUser) { window.location.href = "login.html"; return; }

    const cid = reactEl.dataset.cid;
    const type = reactEl.dataset.react;
    if (pendingReactions.has(cid)) return;
    pendingReactions.add(cid);

    const reactRef = doc(db, "comment_reactions", `${cid}_${currentUser.uid}`);
    const commentRef = doc(db, "comments", cid);
    const target = allComments.find(c => c.id === cid);
    const prevType = userReactions[cid];

    try {
      // Catatan: idealnya dua penulisan di bawah (dokumen reaksi + counter
      // like/dislike komentar) digabung jadi satu writeBatch supaya atomik.
      // Untuk sekarang dibuat sekuensial biasa (setDoc/deleteDoc lalu
      // updateDoc) supaya TIDAK butuh import "writeBatch" tambahan dari
      // firebase-config.js. increment() tetap dipakai jadi counter tetap
      // aman dari race condition banyak user bereaksi bersamaan; yang
      // belum sepenuhnya atomik cuma kombinasi "reaction doc + counter"
      // itu sendiri kalau salah satu request gagal di tengah jalan.
      if (prevType === type) {
        // klik ulang tombol yang sama -> batalkan reaksi
        const field = type === "like" ? "likeCount" : "dislikeCount";
        if (target) target[field] = Math.max((target[field] || 1) - 1, 0);
        delete userReactions[cid];
        renderCommentsList();
        await deleteDoc(reactRef);
        await updateDoc(commentRef, { [field]: increment(-1) });

      } else if (prevType) {
        // pindah dari like ke dislike (atau sebaliknya)
        const oldField = prevType === "like" ? "likeCount" : "dislikeCount";
        const newField = type === "like" ? "likeCount" : "dislikeCount";
        if (target) {
          target[oldField] = Math.max((target[oldField] || 1) - 1, 0);
          target[newField] = (target[newField] || 0) + 1;
        }
        userReactions[cid] = type;
        renderCommentsList();
        await setDoc(reactRef, { commentId: cid, uid: currentUser.uid, type, videoId });
        await updateDoc(commentRef, { [oldField]: increment(-1), [newField]: increment(1) });

      } else {
        // belum pernah bereaksi -> reaksi baru
        const field = type === "like" ? "likeCount" : "dislikeCount";
        if (target) target[field] = (target[field] || 0) + 1;
        userReactions[cid] = type;
        renderCommentsList();
        await setDoc(reactRef, { commentId: cid, uid: currentUser.uid, type, videoId });
        await updateDoc(commentRef, { [field]: increment(1) });
      }
    } catch (err) {
      console.error("Gagal menyimpan reaksi komentar:", err.message);
      if (prevType) userReactions[cid] = prevType; else delete userReactions[cid];
      renderCommentsList();
      alert("Gagal menyimpan reaksi. Coba lagi.");
    } finally {
      pendingReactions.delete(cid);
    }
  }
});

// ---------- Kolom komentar: bottom-bar mengambang saat fokus ----------
// Didesain ulang total dari versi "pin video ke atas + hitung top manual"
// (versi itu gampang meleset -> muncul jarak kosong aneh di atas video,
// keliatan maksa & gak konsisten di semua HP/browser).
//
// Sekarang ngikutin pola app populer (IG/YouTube/TikTok): video DIBIARKAN
// di tempatnya, gak dipindah-pindah sama sekali. Yang jadi overlay cuma
// kolom komentar -> nempel sebagai bar full-width di BAWAH layar, pas di
// atas keyboard. Jauh lebih simpel & stabil karena cuma gantung ke 1 nilai
// (tinggi keyboard dari visualViewport), bukan ke banyak perhitungan posisi
// elemen lain yang gampang salah hitung.
let commentZoomController = null;

function setupCommentFocusZoom() {
  const box = document.querySelector(".comment-box");
  const input = document.getElementById("comment-input");
  const btnSend = document.getElementById("btn-comment");
  if (!box || !input || !btnSend) return null;

  let isActive = false;
  let placeholder = null; // jaga tinggi ruang aslinya biar konten di bawah gak "loncat"
  let rafId = null; // buat nunda perhitungan posisi sampai browser selesai 1 frame animasi

  function getKeyboardOffset() {
    const vv = window.visualViewport;
    if (!vv) return 0;
    const gap = window.innerHeight - vv.height - vv.offsetTop;
    return gap > 24 ? gap : 0;
  }

  function positionBar() {
    if (!isActive) return;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!isActive) return;
      box.style.setProperty("bottom", getKeyboardOffset() + "px", "important");
    });
  }

  function activate() {
    if (input.disabled || isActive) return;

    const rect = box.getBoundingClientRect();
    placeholder = document.createElement("div");
    placeholder.style.height = rect.height + "px";
    box.parentNode.insertBefore(placeholder, box);

    box.style.setProperty("position", "fixed", "important");
    box.style.setProperty("top", "auto", "important");
    box.style.setProperty("left", "0", "important");
    box.style.setProperty("right", "0", "important");
    box.style.setProperty("bottom", "0", "important");
    box.style.setProperty("z-index", "999", "important");
    box.style.setProperty("margin", "0", "important");
    box.style.setProperty("border-radius", "0", "important");
    box.style.setProperty("box-shadow", "0 -4px 16px rgba(0,0,0,.45)", "important");

    document.body.classList.add("comment-focus-active");
    box.classList.add("is-focused");
    isActive = true;
    positionBar();
  }

  function deactivate() {
    if (!isActive) return;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    box.classList.remove("is-focused");
    document.body.classList.remove("comment-focus-active");

    ["position", "top", "left", "right", "bottom", "z-index", "margin", "border-radius", "box-shadow"]
      .forEach(prop => box.style.removeProperty(prop));

    if (placeholder) {
      placeholder.remove();
      placeholder = null;
    }
    isActive = false;
  }

  input.addEventListener("focus", activate);
  input.addEventListener("blur", deactivate);

  btnSend.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", positionBar);
    window.visualViewport.addEventListener("scroll", positionBar);
  }

  return {
    activate, deactivate, reposition: positionBar,
    isActive: () => isActive
  };
}

commentZoomController = setupCommentFocusZoom();

// ---------- Layout ringkas: textarea auto-resize + daftar komentar dibatasi tinggi ----------
// PENYEMPURNAAN: dipersempit sedikit (44->38, 120->100) supaya kolom
// input terasa lebih compact, sesuai pola aplikasi video modern.
const COMMENT_TEXTAREA_MIN_H = 38;   // ~1.5 baris
const COMMENT_TEXTAREA_MAX_H = 100;  // ~4 baris sebelum scroll sendiri
const COMMENT_LIST_MAX_H = "min(50vh, 420px)";

function resetTextareaHeight(el) {
  el.style.setProperty("height", COMMENT_TEXTAREA_MIN_H + "px", "important");
}

function autoGrowTextarea(el) {
  el.style.setProperty("height", "auto", "important");
  const next = Math.min(Math.max(el.scrollHeight, COMMENT_TEXTAREA_MIN_H), COMMENT_TEXTAREA_MAX_H);
  el.style.setProperty("height", next + "px", "important");
}

(function setupCompactCommentLayout() {
  const input = document.getElementById("comment-input");
  const list = document.getElementById("comment-list");

  if (input) {
    input.style.setProperty("min-height", COMMENT_TEXTAREA_MIN_H + "px", "important");
    input.style.setProperty("max-height", COMMENT_TEXTAREA_MAX_H + "px", "important");
    input.style.setProperty("overflow-y", "auto", "important");
    input.style.setProperty("resize", "none", "important");
    resetTextareaHeight(input);
    input.addEventListener("input", () => {
      autoGrowTextarea(input);
      // PENYEMPURNAAN: sinkronkan disabled/enabled tombol kirim SVG tiap
      // user mengetik (empty = disabled, ada isi = enabled) -- tidak
      // menyentuh logic auto-grow yang sudah ada di atasnya.
      refreshSendButtonState();
    });
    refreshSendButtonState(); // state awal saat halaman baru dibuka
  }

  if (list) {
    list.style.setProperty("max-height", COMMENT_LIST_MAX_H, "important");
    list.style.setProperty("overflow-y", "auto", "important");
    // PENYEMPURNAAN: containment scroll -- scroll di dalam daftar komentar
    // TIDAK "bocor" ke scroll halaman utama saat sudah mentok atas/bawah
    // (mencegah scroll chaining yang mengganggu). -webkit-overflow-scrolling
    // bikin momentum scroll di iOS terasa natural.
    list.style.setProperty("overscroll-behavior", "contain", "important");
    list.style.setProperty("-webkit-overflow-scrolling", "touch", "important");
  }
})();

// ---------- Tombol kirim: ikon SVG pesawat kertas (bulat) ----------
// Menggantikan TAMPILAN tombol teks "Kirim" jadi tombol bulat berisi SVG
// inline -- id, event listener "click", dan seluruh logic kirim komentar
// TIDAK berubah sama sekali (listener tetap terpasang ke elemen
// #btn-comment yang sama persis).
(function setupSendButtonIcon() {
  const btn = document.getElementById("btn-comment");
  if (!btn) return;
  btn.classList.add("btn-send");
  btn.setAttribute("aria-label", "Kirim komentar");
  btn.innerHTML = `
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z"/>
      <path d="M22 2 11 13"/>
    </svg>`;
})();

// ---------- Deskripsi ringkas dengan toggle "Selengkapnya" ----------
function setupCollapsibleDescription(descEl, fullText) {
  descEl.textContent = fullText;
  descEl.style.setProperty("display", "-webkit-box", "important");
  descEl.style.setProperty("-webkit-box-orient", "vertical", "important");
  descEl.style.setProperty("-webkit-line-clamp", "2", "important");
  descEl.style.setProperty("overflow", "hidden", "important");

  const old = document.getElementById("btn-toggle-desc");
  if (old) old.remove();

  if (fullText.length <= 90) return;

  const toggle = document.createElement("span");
  toggle.id = "btn-toggle-desc";
  toggle.textContent = "Selengkapnya";
  toggle.style.cssText =
    "display:inline-block;margin-top:4px;font-size:.78rem;font-weight:600;color:var(--accent,#ff7a00);cursor:pointer";
  descEl.insertAdjacentElement("afterend", toggle);

  let expanded = false;
  toggle.addEventListener("click", () => {
    expanded = !expanded;
    if (expanded) {
      descEl.style.setProperty("-webkit-line-clamp", "unset", "important");
      descEl.style.setProperty("overflow", "visible", "important");
      toggle.textContent = "Tutup";
    } else {
      descEl.style.setProperty("-webkit-line-clamp", "2", "important");
      descEl.style.setProperty("overflow", "hidden", "important");
      toggle.textContent = "Selengkapnya";
    }
  });
}

// ============================================================
// Section Komentar — collapsed default, full-area toggle, preview,
// micro-interaction, animasi halus, accessibility.
// ============================================================
// PENYEMPURNAAN atas sistem existing, BUKAN sistem baru:
//  - comment count & preview: reuse `topLevel` yang sudah dihitung di
//    renderCommentsList() -- tidak ada query Firestore tambahan.
//  - realtime: tetap pakai listenComments() / onSnapshot yang sudah ada,
//    tidak ada listener kedua; fungsi di sini hanya dipanggil dari
//    renderCommentsList() yang sudah jadi satu-satunya "sumber render".
//  - Like/Dislike/Reply/sorting/pagination: TIDAK disentuh sama sekali.
//  - Video Terkait: berada di container terpisah (#related-list) di luar
//    wrapper toggle ini, tidak ikut dianimasikan/collapse.
// ============================================================

function findCommentHeading() {
  const headingTags = document.querySelectorAll("h1,h2,h3,h4,h5,h6");
  for (const el of headingTags) {
    if (el.textContent.trim() === "Komentar") return el;
  }
  const all = document.querySelectorAll("body *");
  for (const el of all) {
    if (el.children.length === 0 && el.textContent.trim() === "Komentar") return el;
  }
  return null;
}

function injectCommentToggleStyles() {
  if (document.getElementById("nokt-comment-toggle-style")) return;
  const style = document.createElement("style");
  style.id = "nokt-comment-toggle-style";
  style.textContent = `
    .comment-toggle-header{cursor:pointer;user-select:none;display:flex;flex-direction:column;gap:2px;padding:4px 0}
    .comment-toggle-header:focus-visible{outline:2px solid var(--accent,#ff7a00);outline-offset:2px;border-radius:4px}
    .comment-toggle-heading-row{display:flex;align-items:center;gap:8px}
    .comment-toggle-arrow{font-size:.7em;transition:transform .2s ease;display:inline-block}
    .comment-preview{font-size:.78rem;line-height:1.35;color:var(--text-muted);max-width:100%;
      overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;
      -webkit-box-orient:vertical;overflow-wrap:anywhere;word-break:break-word;margin-top:2px}
    .comment-expand-content{overflow:hidden;max-height:0;opacity:0;
      transition:max-height .28s ease, opacity .22s ease}
    .comment-expand-content.is-open{opacity:1}
    @keyframes nokt-comment-pulse{0%{opacity:1}50%{opacity:.5}100%{opacity:1}}
    .comment-toggle-header.pulse #comment-count,
    .comment-toggle-header.pulse #comment-count-header,
    .comment-toggle-header.pulse .comment-preview{animation: nokt-comment-pulse 1.3s ease 1}

    /* ---- Comment Preview Rotation (mini hero slider) ----
       Transisi ringan (fade + slide 4px), TIDAK mengubah tinggi container
       -- .comment-preview sudah dibatasi -webkit-line-clamp:2 di atas,
       jadi tinggi tetap stabil walau isi teks beda panjang. */
    .comment-preview{transition:opacity .2s ease, transform .2s ease}
    .comment-preview.preview-rotating{opacity:0;transform:translateY(-4px)}

    /* ---- Sticky sub-header (jumlah komentar + sort) di dalam area
       komentar yang terbuka ----
       Elemen ini ditaruh SEBELUM #comment-list secara DOM (bukan anak dari
       list yang di-scroll), jadi dia otomatis selalu terlihat begitu list
       di-scroll ke bawah -- position:sticky ditambahkan sebagai jaring
       pengaman ekstra di skenario/browser tertentu. */
    #comment-subheader{
      position:sticky;
      top:0;
      z-index:5;
      background:var(--surface,#141416);
      border-bottom:1px solid var(--border,#232326);
      padding-top:8px;
      padding-bottom:8px;
      transition:padding .25s ease;
    }

    /* ---- Compact mode saat daftar komentar di-scroll ----
       Dipicu class "comments-scrolled" pada wrapper #comment-expand-content
       (lihat listener "scroll" di setupCollapsibleCommentsSection). Cuma
       padding/spacing yang dikurangi, info & ukuran font tidak disentuh. */
    #comment-expand-content.comments-scrolled #comment-subheader{
      padding-top:4px;
      padding-bottom:4px;
    }
    .comment-item{
      transition:padding .22s ease;
    }
    #comment-expand-content.comments-scrolled .comment-item{
      padding:7px 0;
    }

    /* ---- Tombol kirim: ikon SVG pesawat kertas, bulat ----
       Menggantikan tampilan tombol teks lama TANPA mengubah id/listener. */
    #btn-comment.btn-send{
      width:38px;height:38px;min-width:38px;padding:0;
      border-radius:50%;
      display:inline-flex;align-items:center;justify-content:center;
      background:var(--accent,#ff7a1a);
      color:#0A0A0B;border:none;cursor:pointer;
      transition:transform .15s ease, opacity .15s ease, filter .15s ease;
    }
    #btn-comment.btn-send:hover:not(:disabled){ filter:brightness(1.08); }
    #btn-comment.btn-send:active:not(:disabled){ transform:scale(.88); }
    #btn-comment.btn-send:disabled{ opacity:.4; cursor:not-allowed; }
    #btn-comment.btn-send.is-sending{ opacity:.7; }
    @keyframes nokt-send-pulse{
      0%{ transform:scale(1); }
      45%{ transform:scale(1.22); }
      100%{ transform:scale(1); }
    }
    #btn-comment.btn-send.sent{ animation: nokt-send-pulse .4s ease; }
  `;
  document.head.appendChild(style);
}

// Komentar top-level TERBARU untuk preview -- selalu berdasarkan createdAt
// asli, terlepas dari sorting Terbaru/Terlama yang sedang dipilih user
// untuk daftar komentar (preview harus tetap konsisten, sesuai spesifikasi).
function getNewestTopLevelComment(topLevel) {
  if (!topLevel.length) return null;
  return topLevel.reduce((newest, c) => {
    const t = c.createdAt?.seconds || 0;
    const nt = newest.createdAt?.seconds || 0;
    return t > nt ? c : newest;
  });
}

let commentSectionExpanded = false;
let lastKnownCommentCount = null;
let syncCommentExpandHeight = null; // di-assign di dalam IIFE setup, dipanggil dari renderCommentsList()

// ============================================================
// Comment Preview Rotation -- "mini hero slider" untuk preview saat
// collapsed. PENYEMPURNAAN UI murni: tidak ada query/listener Firestore
// baru, semua kandidat diambil dari `allComments` yang sudah tersedia
// lewat listenComments() existing. Rotation cuma jalan saat collapsed,
// berhenti total saat section dibuka, dan cuma ada SATU timer aktif
// sepanjang waktu (dijaga lewat guard `if (!previewTimer)` di
// updateCommentToggleHeader + stopPreviewRotation() sebelum start ulang).
// ============================================================
let previewCandidates = [];      // komentar top-level, terbaru dulu -- sumber rotasi
let previewCommentId = null;     // id komentar yang SEDANG tampil di preview
let previewTimer = null;         // satu-satunya timer rotation yang boleh aktif
const PREVIEW_ROTATE_MS = 3500;  // ~3.5 detik, sesuai rentang 3-4 detik di spec

// Urutan dasar kandidat: terbaru dulu (index 0), supaya preview PERTAMA
// yang tampil tetap komentar terbaru -- ini cuma urutan tampilan preview,
// TIDAK menyentuh commentSortOrder (Terbaru/Terlama) punya daftar komentar
// utuh, yang tetap dikendalikan terpisah seperti semula.
function buildPreviewCandidates(topLevel) {
  return [...topLevel].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

// Render satu komentar ke kotak preview. `animate=false` dipakai untuk
// tampilan pertama kali (langsung, tanpa fade) -- fade hanya dipakai saat
// benar-benar berganti index lewat rotation.
function renderCommentPreview(comment, animate) {
  const previewEl = document.getElementById("comment-preview");
  if (!previewEl || !comment) return;
  const html = `"${escapeHtml(comment.text)}"<br><span style="font-weight:600">${escapeHtml(comment.userName || 'User')}</span> · ${formatCommentDate(comment.createdAt)}`;
  if (animate === false) {
    previewEl.innerHTML = html;
    return;
  }
  previewEl.classList.add("preview-rotating");
  setTimeout(() => {
    previewEl.innerHTML = html;
    previewEl.classList.remove("preview-rotating");
  }, 200);
}

function stopPreviewRotation() {
  if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }
}

// PENCEGAHAN MULTIPLE TIMER: selalu stop dulu sebelum start, jadi tidak
// mungkin ada 2 interval jalan bersamaan walau fungsi ini kepanggil
// berkali-kali (misal karena listenComments() nembak beberapa kali).
function startPreviewRotation() {
  stopPreviewRotation();
  if (commentSectionExpanded) return;           // jangan jalan saat komentar terbuka
  if (previewCandidates.length < 2) return;      // 0-1 komentar -> tidak perlu rotasi

  previewTimer = setInterval(() => {
    // Guard tambahan di dalam timer -- kalau section sempat dibuka atau
    // kandidat berkurang jadi <2 SETELAH timer jalan, hentikan diri sendiri.
    if (commentSectionExpanded || previewCandidates.length < 2) {
      stopPreviewRotation();
      return;
    }
    const idx = previewCandidates.findIndex(c => c.id === previewCommentId);
    const nextIdx = (idx + 1) % previewCandidates.length; // round-robin, gak ada duplikat sampai semua kebagian giliran
    const next = previewCandidates[nextIdx];
    previewCommentId = next.id;
    renderCommentPreview(next, true);
  }, PREVIEW_ROTATE_MS);
}

// Update jumlah komentar (akurat, dari data asli) + preview komentar
// (dengan rotation kalau 2+) saat collapsed + micro-interaction singkat
// (±1.3 detik, bukan animasi terus-menerus) saat jumlah bertambah
// dibanding sebelumnya.
//
// FIX (sebelumnya): fungsi ini cuma nulis ke #comment-count (elemen ASLI
// yang sudah dipindah paksa ke header). Sekarang #comment-count TETAP di
// tempat asalnya (baris bareng tombol sort, tidak dipindah lagi -- lihat
// setupCollapsibleCommentsSection di bawah), dan ditambahkan
// #comment-count-header sebagai salinan tampilan KHUSUS untuk area header
// collapse. Dua-duanya disinkronkan angkanya di sini; header-nya saja yang
// disembunyikan saat expanded.
function updateCommentToggleHeader(topLevel) {
  const countEl = document.getElementById("comment-count");
  const headerCountEl = document.getElementById("comment-count-header");
  const previewEl = document.getElementById("comment-preview");
  const headerEl = document.getElementById("comment-toggle-header");
  if (!countEl) return;

  const count = topLevel.length;
  // PENYEMPURNAAN: dua format teks berbeda untuk dua tempat berbeda --
  //  - subHeaderText ("Komentar 380") dipakai di header sticky DI DALAM
  //    area komentar yang terbuka, menggantikan teks lama "380 komentar"
  //    di baris yang sama dengan tombol sort.
  //  - previewText ("380 komentar") TETAP dipakai di preview di bawah
  //    heading "Komentar ▾" saat section masih collapsed -- supaya kata
  //    "Komentar" tidak dobel (headingnya sendiri sudah bertuliskan itu).
  const subHeaderText = `Komentar ${count}`;
  const previewText = `${count} komentar`;
  countEl.textContent = subHeaderText;

  if (headerCountEl) {
    headerCountEl.textContent = previewText;
    // Cuma tampil saat collapsed -- saat expanded, angka asli di baris
    // sort (countEl) yang kelihatan, jadi tidak dobel.
    headerCountEl.style.display = commentSectionExpanded ? "none" : "";
  }

  if (previewEl) {
    if (count > 0 && !commentSectionExpanded) {
      previewEl.style.display = "";
      previewCandidates = buildPreviewCandidates(topLevel);

      // Kalau komentar yg lagi tampil sudah gak ada di daftar kandidat
      // (baru pertama kali render, atau komentar itu dihapus) -> tampilkan
      // yang terbaru (index 0) langsung tanpa animasi fade.
      const stillExists = previewCandidates.some(c => c.id === previewCommentId);
      if (!stillExists) {
        previewCommentId = previewCandidates[0].id;
        renderCommentPreview(previewCandidates[0], false);
      }

      // Rotation cuma di-(re)start kalau memang belum ada timer jalan --
      // supaya listener realtime yang nembak berkali-kali (like/dislike,
      // komentar baru dari user lain) TIDAK reset countdown tiap saat.
      if (previewCandidates.length >= 2) {
        if (!previewTimer) startPreviewRotation();
      } else {
        stopPreviewRotation();
      }
    } else {
      previewEl.style.display = "none";
      previewEl.innerHTML = "";
      stopPreviewRotation(); // HENTIKAN rotation total saat komentar 0 atau section terbuka
    }
  }

  // Hint interaktif ringan: hanya jalan kalau count NAIK dibanding nilai
  // terakhir yang diketahui (bukan saat load pertama kali), dan berhenti
  // sendiri setelah ±1.3 detik -- tidak pernah berulang terus-menerus.
  if (headerEl && lastKnownCommentCount !== null && count > lastKnownCommentCount) {
    headerEl.classList.remove("pulse");
    void headerEl.offsetWidth; // paksa reflow supaya animasi bisa restart kalau beruntun
    headerEl.classList.add("pulse");
    setTimeout(() => headerEl.classList.remove("pulse"), 1400);
  }
  lastKnownCommentCount = count;
}

(function setupCollapsibleCommentsSection() {
  const heading = findCommentHeading();
  const box = document.querySelector(".comment-box");
  const sortNewest = document.getElementById("sort-newest");
  const sortOldest = document.getElementById("sort-oldest");
  const list = document.getElementById("comment-list");
  const countEl = document.getElementById("comment-count");

  // FIX UTAMA: sebelumnya sortNewest & sortOldest diambil SATU-SATU lalu
  // masing-masing dipindah jadi children langsung contentWrap. Ini merusak
  // baris pembungkus aslinya di HTML:
  //   <div style="display:flex;justify-content:space-between;...">
  //     <span id="comment-count">...</span>
  //     <div style="display:flex;gap:6px">
  //       <button id="sort-newest">Terbaru</button>
  //       <button id="sort-oldest">Terlama</button>
  //     </div>
  //   </div>
  // Div pembungkus itu ditinggal kosong, dan tombol Kirim (dari .comment-box,
  // yang tetap di posisinya) jadi nempel langsung ke tombol Terbaru tanpa
  // jarak -- itulah yang menyebabkan Kirim numpuk ke Terbaru/Terlama.
  //
  // Sekarang seluruh BARIS itu (sortRow = pembungkus terluar berisi
  // comment-count + sort buttons) dipindah UTUH sebagai satu unit, jadi
  // "justify-content:space-between" dan spacing aslinya tetap berlaku persis
  // seperti semula -- tidak ada elemen yang dicerai-beraikan.
  const sortRow = sortNewest ? sortNewest.parentElement.parentElement : null;

  // PENYEMPURNAAN: baris ini (jumlah komentar + tombol sort) dijadikan
  // header sticky di dalam area komentar. Diberi id supaya bisa ditarget
  // CSS (#comment-subheader di injectCommentToggleStyles) tanpa mengubah
  // konten/child elemennya sama sekali -- masih sortNewest & sortOldest
  // yang sama, masih countEl yang sama.
  if (sortRow) sortRow.id = "comment-subheader";

  if (!heading || !list) return;

  injectCommentToggleStyles();

  // ---- Header gabungan: heading + jumlah + preview, jadi SATU area yang
  // full-nya bisa diklik/tap (bukan cuma teks "Komentar"). Elemen asli
  // (heading) DIPINDAH ke dalam wrapper ini, tidak diganti. ----
  const headerWrap = document.createElement("div");
  headerWrap.id = "comment-toggle-header";
  headerWrap.className = "comment-toggle-header";
  headerWrap.setAttribute("role", "button");
  headerWrap.setAttribute("tabindex", "0");
  headerWrap.setAttribute("aria-expanded", "false");
  headerWrap.setAttribute("aria-controls", "comment-expand-content");

  const headingRow = document.createElement("div");
  headingRow.className = "comment-toggle-heading-row";
  heading.parentNode.insertBefore(headerWrap, heading);
  headingRow.appendChild(heading);

  const arrow = document.createElement("span");
  arrow.className = "comment-toggle-arrow";
  // FIX: dulu diisi karakter unicode "▾" di sini. Sekarang segitiga
  // digambar murni via CSS border (.comment-toggle-arrow di style.css)
  // dan rotasinya mengikuti atribut aria-expanded yang di-set di
  // applyState() di bawah -- textContent SENGAJA dikosongkan supaya
  // tidak ada karakter unicode yang bertumpuk dengan triangle CSS.
  arrow.textContent = "";
  headingRow.appendChild(arrow);
  headerWrap.appendChild(headingRow);

  // FIX: dulu #comment-count (elemen ASLI, yang juga dipakai di baris
  // sort) ditarik paksa ke sini lewat headerWrap.appendChild(countEl) --
  // itu yang bikin baris count+sort di bawah kehilangan elemennya. Sekarang
  // dibuat SPAN BARU khusus buat preview di header (angkanya disinkronkan
  // di updateCommentToggleHeader), sementara #comment-count asli TETAP di
  // dalam sortRow, tidak dipindah sama sekali.
  const headerCountEl = document.createElement("span");
  headerCountEl.id = "comment-count-header";
  headerCountEl.style.cssText = "font-size:.8rem;color:var(--text-muted)";
  headerWrap.appendChild(headerCountEl);

  const previewEl = document.createElement("div");
  previewEl.id = "comment-preview";
  previewEl.className = "comment-preview";
  previewEl.style.display = "none";
  headerWrap.appendChild(previewEl);

  // ---- Wrapper konten yang di-toggle (input, baris count+sort, daftar
  // komentar) supaya bisa dianimasikan smooth SEKALIGUS, tanpa mengubah
  // elemen aslinya (cuma dipindah ke dalam wrapper, urutan & struktur
  // internalnya dipertahankan utuh). ----
  const contentWrap = document.createElement("div");
  contentWrap.id = "comment-expand-content";
  contentWrap.className = "comment-expand-content";
  list.parentNode.insertBefore(contentWrap, box || sortRow || list);
  // FIX (dipertahankan): sortRow (satu baris utuh count+sort) yang
  // dipindah, bukan sortNewest/sortOldest satu-satu -- struktur
  // flex/space-between aslinya tetap sama persis seperti di HTML.
  //
  // PENYEMPURNAAN (dikembalikan sesuai permintaan): urutan penempatan
  // TETAP [box, sortRow, list] seperti semula -- kolom "Tulis komentar"
  // balik ke posisi PALING ATAS (persis kondisi awal). Yang jadi header
  // sticky & scrollable hanyalah daftar komentar orang lain (sortRow +
  // list), yang posisinya tepat di bawah kolom input, dan tetap berada
  // di atas section "Video Terkait" (karena section komentar & aside
  // Video Terkait adalah dua blok terpisah di watch.html -- lihat
  // .watch-layout -- urutan di dalam komentar tidak memengaruhi itu).
  [box, sortRow, list].forEach(el => { if (el) contentWrap.appendChild(el); });

  // ---------- Compact mode saat daftar komentar di-scroll ----------
  // Begitu user scroll #comment-list menjauh dari paling atas, header
  // sticky & item komentar jadi lebih padat (padding dikurangi lewat CSS
  // class "comments-scrolled", transisinya diatur CSS transition ~220-250ms
  // di injectCommentToggleStyles). Balik normal lagi begitu scroll kembali
  // ke posisi paling atas. Ini scroll INTERNAL milik #comment-list saja,
  // TIDAK ada hubungannya dengan scroll halaman utama.
  if (list) {
    list.addEventListener("scroll", () => {
      contentWrap.classList.toggle("comments-scrolled", list.scrollTop > 8);
    }, { passive: true });
  }

  function applyState(expanded, animate) {
    commentSectionExpanded = expanded;
    // FIX: dulu di sini juga diisi "▴"/"▾" (arrow.textContent = expanded ?
    // "▴" : "▾"). Sekarang textContent tidak lagi disentuh -- rotasi arah
    // panah sepenuhnya ditangani CSS via selector
    // .comment-toggle-header[aria-expanded="true"] .comment-toggle-arrow,
    // yang dipicu oleh setAttribute("aria-expanded", ...) tepat di bawah ini.
    headerWrap.setAttribute("aria-expanded", String(expanded));

    if (!animate) {
      // Terapkan langsung tanpa transisi -- dipakai saat load awal saja,
      // supaya tidak ada animasi yang kelihatan saat halaman baru dibuka.
      contentWrap.style.transition = "none";
      if (expanded) {
        contentWrap.style.display = "";
        contentWrap.classList.add("is-open");
        contentWrap.style.maxHeight = "none";
      } else {
        contentWrap.style.maxHeight = "0px";
        contentWrap.classList.remove("is-open");
        contentWrap.style.display = "none";
      }
      void contentWrap.offsetWidth;
      contentWrap.style.transition = "";
    } else if (expanded) {
      contentWrap.style.display = "";
      contentWrap.classList.add("is-open");
      const target = contentWrap.scrollHeight;
      contentWrap.style.maxHeight = "0px";
      requestAnimationFrame(() => { contentWrap.style.maxHeight = target + "px"; });
      // Lepas batas tinggi setelah animasi selesai, supaya konten yang
      // tinggi berubah belakangan (komentar baru dst) tidak terpotong.
      setTimeout(() => { if (commentSectionExpanded) contentWrap.style.maxHeight = "none"; }, 320);
    } else {
      const current = contentWrap.scrollHeight;
      contentWrap.style.maxHeight = current + "px";
      requestAnimationFrame(() => {
        contentWrap.style.maxHeight = "0px";
        contentWrap.classList.remove("is-open");
      });
      setTimeout(() => { if (!commentSectionExpanded) contentWrap.style.display = "none"; }, 300);
    }

    // Preview cuma relevan saat collapsed -- refresh setiap kali status berubah.
    updateCommentToggleHeader(allComments.filter(c => !c.parentId));
  }

  // Kalau sedang expanded dan tinggi konten berubah (komentar/reply baru),
  // sinkronkan ulang max-height supaya tidak ada bagian yang terpotong.
  syncCommentExpandHeight = function () {
    if (!commentSectionExpanded) return;
    if (contentWrap.style.maxHeight !== "none") {
      contentWrap.style.maxHeight = contentWrap.scrollHeight + "px";
    }
  };

  headerWrap.addEventListener("click", () => applyState(!commentSectionExpanded, true));
  headerWrap.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      applyState(!commentSectionExpanded, true);
    }
  });

  applyState(false, false); // mulai collapsed, tanpa animasi di load awal
})();

loadVideo();
