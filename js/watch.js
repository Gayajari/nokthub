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
import { getAvatarForUid, DEFAULT_AVATARS } from "./auth.js";

// ---------- FIX: header komentar "macet"/ketutup navbar ----------
function updateSiteHeaderHeightVar() {
  const header = document.querySelector(".site-header");
  if (!header) return;
  const h = Math.ceil(header.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--site-header-h", h + "px");
}
updateSiteHeaderHeightVar();
window.addEventListener("resize", updateSiteHeaderHeightVar);
window.addEventListener("orientationchange", () => setTimeout(updateSiteHeaderHeightVar, 150));
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(updateSiteHeaderHeightVar);
}

const params = new URLSearchParams(window.location.search);
const videoId = params.get("id");
let currentUser = null;
let videoData = null;
let unsubscribeStats = null;

const MIN_WATCH_SECONDS = 10;
const VIEW_WINDOW_MS = 5 * 60 * 1000;
let viewCounted = false;

const ICON_THUMB_UP = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>`;
const ICON_THUMB_DOWN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>`;

onAuthStateChanged(auth, (u) => {
  currentUser = u;
  checkLikeState();
  updateCommentBoxState();
  loadUserReactions();
});

function updateCommentBoxState() {
  const input = document.getElementById("comment-input");
  const btn = document.getElementById("btn-comment");
  const hint = document.getElementById("comment-login-hint");
  if (!input || !btn) return;
  const loggedIn = !!currentUser;
  input.disabled = !loggedIn;
  input.placeholder = loggedIn ? "Tulis komentar..." : "Tulis komentar...";
  if (hint) hint.style.display = loggedIn ? "none" : "inline";
  refreshSendButtonState();
}

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

  if (videoData.category) {
    const qCategory = query(
      collection(db, "videos"),
      where("status", "==", "publish"),
      where("category", "==", videoData.category),
      limit(RELATED_CANDIDATE_POOL)
    );
    addAll((await getDocs(qCategory)).docs.map(d => ({ id: d.id, ...d.data() })));
  }

  if (seen.size < RELATED_CANDIDATE_POOL && (videoData.tags || []).length) {
    const qTags = query(
      collection(db, "videos"),
      where("status", "==", "publish"),
      where("tags", "array-contains-any", videoData.tags.slice(0, 10)),
      limit(RELATED_CANDIDATE_POOL)
    );
    addAll((await getDocs(qTags)).docs.map(d => ({ id: d.id, ...d.data() })));
  }

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

  const fixedTop = candidates.slice(0, RELATED_FIXED_TOP);
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

let allComments = [];
let userReactions = {};
let commentSortOrder = "desc";
let commentDisplayLimit = 1;
const COMMENT_FIRST_REVEAL = 3;
let unsubscribeComments = null;
const pendingReactions = new Set();
let activeReplyBox = null;
const expandedReplies = new Set();
const replyDisplayLimits = {};
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
window.addEventListener("beforeunload", () => { stopPreviewRotation(); });

function renderCommentsList() {
  const list = document.getElementById("comment-list");
  const topLevel = allComments.filter(c => !c.parentId);
  const visible = topLevel.slice(0, commentDisplayLimit);

  const prevScrollTop = list.scrollTop;

  list.innerHTML = visible.map(c => renderComment(c, allComments)).join("")
    || `<p style="color:var(--text-muted)">Belum ada komentar.<br>Tulis komentar pertama...</p>`;

  if (topLevel.length > commentDisplayLimit) {
    const sisa = topLevel.length - commentDisplayLimit;
    list.innerHTML += `
      <button class="share-btn" id="btn-load-more-comments" style="width:100%;margin-top:10px">
        Lihat komentar lainnya (${sisa})
      </button>`;
  }

  list.scrollTop = prevScrollTop;

  updateCommentToggleHeader(topLevel);

  if (commentZoomController && commentZoomController.isActive()) {
    commentZoomController.reposition();
  }

  if (typeof syncCommentExpandHeight === "function") syncCommentExpandHeight();
}

document.getElementById("comment-list").addEventListener("click", (e) => {
  if (e.target.id === "btn-load-more-comments") {
    commentDisplayLimit = commentDisplayLimit < COMMENT_FIRST_REVEAL
      ? COMMENT_FIRST_REVEAL
      : Infinity;
    renderCommentsList();
  }
});

document.querySelectorAll("#sort-newest, #sort-oldest").forEach(btn => {
  btn.addEventListener("click", () => {
    commentSortOrder = btn.dataset.sort;
    commentDisplayLimit = 1;
    document.querySelectorAll("#sort-newest, #sort-oldest").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    listenComments();
  });
});
document.getElementById("sort-newest").classList.add("active");

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

// ---------- Avatar komentar ----------
// Kalau komentar itu tidak punya userPhoto (data lama / user daftar via
// email sebelum fitur avatar default ada), pakai salah satu dari 5 avatar
// lokal kita, dipilih KONSISTEN berdasarkan uid pemilik komentar (lihat
// getAvatarForUid di auth.js) -- supaya user yang sama selalu tampil
// dengan avatar yang sama di semua komentarnya, bukan ganti-ganti acak.
// onerror juga dipasang jaga-jaga kalau url foto (mis. dari Google) rusak.
function commentAvatarUrl(c) {
  return c.userPhoto || getAvatarForUid(c.uid || "anon");
}

function renderComment(c, all) {
  const replies = all.filter(r => r.parentId === c.id);
  const isOwner = currentUser && currentUser.uid === c.uid;
  const myReaction = userReactions[c.id];
  const isExpanded = expandedReplies.has(c.id);
  const replyLimit = replyDisplayLimits[c.id] || REPLY_BATCH_SIZE;
  const visibleReplies = replies.slice(0, replyLimit);
  const sisaReplies = replies.length - visibleReplies.length;

  const wrapStyle = "overflow-wrap:anywhere;word-break:break-word";

  return `
    <div class="comment-item" style="max-width:100%">
      <img src="${commentAvatarUrl(c)}" alt="" style="flex-shrink:0" onerror="this.onerror=null;this.src='${DEFAULT_AVATARS[0]}'">
      <div class="comment-body" style="flex:1;min-width:0">
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
          <div class="comment-body" style="margin-top:8px;padding-left:14px;border-left:2px solid var(--border);max-width:100%">
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

document.getElementById("btn-comment").addEventListener("click", async () => {
  if (!currentUser) { window.location.href = "login.html"; return; }
  const input = document.getElementById("comment-input");
  const btn = document.getElementById("btn-comment");
  const text = input.value.trim();
  if (!text) return;

  btn.disabled = true;
  btn.classList.add("is-sending");
  try {
    await addDoc(collection(db, "comments"), {
      videoId, uid: currentUser.uid,
      userName: currentUser.displayName || "User",
      userPhoto: currentUser.photoURL || getAvatarForUid(currentUser.uid),
      text, parentId: null, likeCount: 0, dislikeCount: 0,
      createdAt: serverTimestamp()
    });
    input.value = "";
    resetTextareaHeight(input);
    input.blur();
    btn.classList.remove("is-sending");
    btn.classList.add("sent");
    btn.classList.add("glow-sent");
    setTimeout(() => btn.classList.remove("sent"), 400);
    setTimeout(() => btn.classList.remove("glow-sent"), 2000);
  } catch (err) {
    console.error("Gagal mengirim komentar:", err.message);
    alert("Komentar gagal terkirim. Coba lagi sebentar lagi.\n(" + err.message + ")");
    btn.classList.remove("is-sending");
  } finally {
    refreshSendButtonState();
  }
});

document.getElementById("comment-list").addEventListener("click", async (e) => {
  if (e.target.classList.contains("comment-body") && closeCommentsSection) {
    closeCommentsSection();
    return;
  }

  const delId = e.target.dataset.del;
  if (delId) {
    await deleteDoc(doc(db, "comments", delId));
    return;
  }

  const replyId = e.target.dataset.reply;
  if (replyId) {
    if (!currentUser) { window.location.href = "login.html"; return; }
    activeReplyBox = activeReplyBox === replyId ? null : replyId;
    renderCommentsList();
    return;
  }

  if (e.target.classList.contains("btn-cancel-reply")) {
    activeReplyBox = null;
    renderCommentsList();
    return;
  }

  const toggleId = e.target.dataset.toggleReplies;
  if (toggleId) {
    if (expandedReplies.has(toggleId)) {
      expandedReplies.delete(toggleId);
      delete replyDisplayLimits[toggleId];
    } else {
      expandedReplies.add(toggleId);
    }
    renderCommentsList();
    return;
  }

  const moreRepliesId = e.target.dataset.moreReplies;
  if (moreRepliesId) {
    replyDisplayLimits[moreRepliesId] = (replyDisplayLimits[moreRepliesId] || REPLY_BATCH_SIZE) + REPLY_BATCH_SIZE;
    renderCommentsList();
    return;
  }

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
        userPhoto: currentUser.photoURL || getAvatarForUid(currentUser.uid),
        text, parentId, likeCount: 0, dislikeCount: 0,
        createdAt: serverTimestamp()
      });
      activeReplyBox = null;
      expandedReplies.add(parentId);
    } catch (err) {
      console.error("Gagal mengirim balasan:", err.message);
      alert("Balasan gagal terkirim. Coba lagi.");
    } finally {
      e.target.disabled = false;
    }
    return;
  }

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
      if (prevType === type) {
        const field = type === "like" ? "likeCount" : "dislikeCount";
        if (target) target[field] = Math.max((target[field] || 1) - 1, 0);
        delete userReactions[cid];
        renderCommentsList();
        await deleteDoc(reactRef);
        await updateDoc(commentRef, { [field]: increment(-1) });

      } else if (prevType) {
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

let commentZoomController = null;

function setupCommentFocusZoom() {
  const box = document.querySelector(".comment-box");
  const input = document.getElementById("comment-input");
  const btnSend = document.getElementById("btn-comment");
  if (!box || !input || !btnSend) return null;

  let isActive = false;
  let placeholder = null;
  let rafId = null;
  let scrollYAtActivate = 0;

  function positionBar() {
    if (!isActive) return;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!isActive) return;
      const vv = window.visualViewport;
      if (!vv) {
        box.style.setProperty("top", "auto", "important");
        box.style.setProperty("bottom", "0px", "important");
        return;
      }
      const boxHeight = box.getBoundingClientRect().height;
      const top = vv.offsetTop + vv.height - boxHeight;
      box.style.setProperty("bottom", "auto", "important");
      box.style.setProperty("top", top + "px", "important");
    });
  }

  function activate() {
    if (input.disabled || isActive) return;

    scrollYAtActivate = window.scrollY;

    const rect = box.getBoundingClientRect();
    placeholder = document.createElement("div");
    placeholder.style.height = rect.height + "px";
    box.parentNode.insertBefore(placeholder, box);

    box.style.setProperty("position", "fixed", "important");
    box.style.setProperty("top", "auto", "important");
    box.style.setProperty("left", "0", "important");
    box.style.setProperty("right", "0", "important");
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

    const meta = document.getElementById("video-meta");
    const heading = document.getElementById("comments-heading");

    [meta, heading].forEach(el => { if (el) el.style.setProperty("transition", "none", "important"); });

    box.classList.remove("is-focused");
    document.body.classList.remove("comment-focus-active");

    ["position", "top", "left", "right", "bottom", "z-index", "margin", "border-radius", "box-shadow"]
      .forEach(prop => box.style.removeProperty(prop));

    if (placeholder) {
      placeholder.remove();
      placeholder = null;
    }
    isActive = false;

    void document.documentElement.offsetHeight;

    const applyCompensation = () => {
      window.scrollTo(0, scrollYAtActivate);
    };

    if (window.visualViewport) {
      let settleTimer = null;
      let applied = false;

      const scheduleSettle = () => {
        if (applied) return;
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          if (applied) return;
          applied = true;
          window.visualViewport.removeEventListener("resize", scheduleSettle);
          requestAnimationFrame(applyCompensation);
        }, 120);
      };

      window.visualViewport.addEventListener("resize", scheduleSettle);

      setTimeout(() => {
        if (!applied) {
          applied = true;
          window.visualViewport.removeEventListener("resize", scheduleSettle);
          applyCompensation();
        }
      }, 450);
    } else {
      applyCompensation();
    }

    requestAnimationFrame(() => {
      [meta, heading].forEach(el => { if (el) el.style.removeProperty("transition"); });
    });
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

const COMMENT_TEXTAREA_MIN_H = 38;
const COMMENT_TEXTAREA_MAX_H = 100;
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
      refreshSendButtonState();
    });
    refreshSendButtonState();
  }

  if (list) {
    list.style.setProperty("max-height", COMMENT_LIST_MAX_H, "important");
    list.style.setProperty("overflow-y", "auto", "important");
    list.style.setProperty("overscroll-behavior", "contain", "important");
    list.style.setProperty("-webkit-overflow-scrolling", "touch", "important");
  }
})();

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

(function setupInlineSendLayout() {
  const box = document.querySelector(".comment-box");
  const textarea = document.getElementById("comment-input");
  const btn = document.getElementById("btn-comment");
  const hint = document.getElementById("comment-login-hint");
  if (!box || !textarea || !btn) return;

  const hintRow = hint ? hint.parentElement : null;

  box.insertBefore(btn, textarea.nextSibling);

  box.style.setProperty("display", "flex", "important");
  box.style.setProperty("flex-wrap", "wrap", "important");
  box.style.setProperty("align-items", "flex-end", "important");
  box.style.setProperty("gap", "8px", "important");

  textarea.style.setProperty("flex", "1 1 auto", "important");
  textarea.style.setProperty("width", "auto", "important");
  textarea.style.setProperty("min-width", "0", "important");
  textarea.style.setProperty("border", "1px solid var(--border, #232326)", "important");
  textarea.style.setProperty("border-radius", "8px", "important");

  if (hintRow) {
    hintRow.style.setProperty("flex-basis", "100%", "important");
    hintRow.style.setProperty("margin-top", "6px", "important");
    hintRow.style.setProperty("order", "3", "important");
  }
})();

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

    .comment-preview{transition:opacity .2s ease, transform .2s ease}
    .comment-preview.preview-rotating{opacity:0;transform:translateY(-4px)}

    #comment-subheader{
      padding-top:8px;
      padding-bottom:8px;
      padding-left:6px;
      padding-right:6px;
      transition:padding .25s ease;
    }

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

    @keyframes nokt-send-glow{
      0%{ box-shadow:0 0 0 0 rgba(255,122,26,0); }
      20%{ box-shadow:0 0 9px 2px rgba(255,122,26,.32); }
      100%{ box-shadow:0 0 0 0 rgba(255,122,26,0); }
    }
    #btn-comment.btn-send.glow-sent{
      animation: nokt-send-glow 2s ease-out;
    }

    #sort-newest, #sort-oldest{
      padding:5px 10px !important;
      font-size:.72rem !important;
    }
  `;
  document.head.appendChild(style);
}

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
let syncCommentExpandHeight = null;
let closeCommentsSection = null;

let previewCandidates = [];
let previewCommentId = null;
let previewTimer = null;
const PREVIEW_ROTATE_MS = 3500;

function buildPreviewCandidates(topLevel) {
  return [...topLevel].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

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

function startPreviewRotation() {
  stopPreviewRotation();
  if (commentSectionExpanded) return;
  if (previewCandidates.length < 2) return;

  previewTimer = setInterval(() => {
    if (commentSectionExpanded || previewCandidates.length < 2) {
      stopPreviewRotation();
      return;
    }
    const idx = previewCandidates.findIndex(c => c.id === previewCommentId);
    const nextIdx = (idx + 1) % previewCandidates.length;
    const next = previewCandidates[nextIdx];
    previewCommentId = next.id;
    renderCommentPreview(next, true);
  }, PREVIEW_ROTATE_MS);
}

function updateCommentToggleHeader(topLevel) {
  const countEl = document.getElementById("comment-count");
  const headerCountEl = document.getElementById("comment-count-header");
  const previewEl = document.getElementById("comment-preview");
  const headerEl = document.getElementById("comment-toggle-header");
  if (!countEl) return;

  const count = topLevel.length;
  const subHeaderText = `Komentar ${count}`;
  const previewText = `${count} komentar`;
  countEl.textContent = subHeaderText;

  if (headerCountEl) {
    headerCountEl.textContent = previewText;
    headerCountEl.style.display = commentSectionExpanded ? "none" : "";
  }

  if (previewEl) {
    if (count > 0 && !commentSectionExpanded) {
      previewEl.style.display = "";
      previewCandidates = buildPreviewCandidates(topLevel);

      const stillExists = previewCandidates.some(c => c.id === previewCommentId);
      if (!stillExists) {
        previewCommentId = previewCandidates[0].id;
        renderCommentPreview(previewCandidates[0], false);
      }

      if (previewCandidates.length >= 2) {
        if (!previewTimer) startPreviewRotation();
      } else {
        stopPreviewRotation();
      }
    } else {
      previewEl.style.display = "none";
      previewEl.innerHTML = "";
      stopPreviewRotation();
    }
  }

  if (headerEl && lastKnownCommentCount !== null && count > lastKnownCommentCount) {
    headerEl.classList.remove("pulse");
    void headerEl.offsetWidth;
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

  const sortRow = sortNewest ? sortNewest.parentElement.parentElement : null;

  if (sortRow) sortRow.id = "comment-subheader";

  if (!heading || !list) return;

  injectCommentToggleStyles();

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
  arrow.textContent = "";
  headingRow.appendChild(arrow);
  headerWrap.appendChild(headingRow);

  const headerCountEl = document.createElement("span");
  headerCountEl.id = "comment-count-header";
  headerCountEl.style.cssText = "font-size:.8rem;color:var(--text-muted)";
  headerWrap.appendChild(headerCountEl);

  const previewEl = document.createElement("div");
  previewEl.id = "comment-preview";
  previewEl.className = "comment-preview";
  previewEl.style.display = "none";
  headerWrap.appendChild(previewEl);

  const contentWrap = document.createElement("div");
  contentWrap.id = "comment-expand-content";
  contentWrap.className = "comment-expand-content";
  list.parentNode.insertBefore(contentWrap, box || sortRow || list);
  [box, sortRow, list].forEach(el => { if (el) contentWrap.appendChild(el); });

  const closeBtn = document.createElement("button");
  closeBtn.id = "btn-close-comments";
  closeBtn.className = "share-btn";
  closeBtn.type = "button";
  closeBtn.textContent = "▲ Tutup komentar";
  closeBtn.style.cssText = "width:100%;margin-top:12px";
  contentWrap.appendChild(closeBtn);

  function doCloseComments() {
    applyState(false, true);
    headerWrap.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  closeCommentsSection = doCloseComments;

  closeBtn.addEventListener("click", doCloseComments);

  if (list) {
    list.addEventListener("scroll", () => {
      contentWrap.classList.toggle("comments-scrolled", list.scrollTop > 8);
    }, { passive: true });
  }

  function applyState(expanded, animate) {
    commentSectionExpanded = expanded;
    headerWrap.setAttribute("aria-expanded", String(expanded));

    if (!animate) {
      contentWrap.style.transition = "none";
      if (expanded) {
        contentWrap.style.display = "";
        contentWrap.classList.add("is-open");
        contentWrap.style.maxHeight = "none";
        contentWrap.style.setProperty("overflow", "visible", "important");
      } else {
        contentWrap.style.maxHeight = "0px";
        contentWrap.classList.remove("is-open");
        contentWrap.style.display = "none";
        contentWrap.style.removeProperty("overflow");
      }
      void contentWrap.offsetWidth;
      contentWrap.style.transition = "";
    } else if (expanded) {
      contentWrap.style.display = "";
      contentWrap.classList.add("is-open");
      const target = contentWrap.scrollHeight;
      contentWrap.style.maxHeight = "0px";
      requestAnimationFrame(() => { contentWrap.style.maxHeight = target + "px"; });
      setTimeout(() => {
        if (commentSectionExpanded) {
          contentWrap.style.maxHeight = "none";
          contentWrap.style.setProperty("overflow", "visible", "important");
        }
      }, 320);
    } else {
      contentWrap.style.removeProperty("overflow");
      const current = contentWrap.scrollHeight;
      contentWrap.style.maxHeight = current + "px";
      requestAnimationFrame(() => {
        contentWrap.style.maxHeight = "0px";
        contentWrap.classList.remove("is-open");
      });
      setTimeout(() => { if (!commentSectionExpanded) contentWrap.style.display = "none"; }, 300);
    }

    updateCommentToggleHeader(allComments.filter(c => !c.parentId));
  }

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

  applyState(false, false);
})();

loadVideo();
