// ============================================================
// NOKT HUB — Watch Page Logic
// ============================================================
import {
  db, auth, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc,
  deleteDoc, query, where, orderBy, limit, increment, serverTimestamp,
  onAuthStateChanged, onSnapshot, writeBatch
} from "./firebase-config.js";
import { renderPlayer, trackResumePosition } from "./player.js";
import { escapeHtml, renderVideoCard } from "./app.js";

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
  btn.disabled = !loggedIn;
  input.placeholder = loggedIn ? "Tulis komentar..." : "Tulis komentar...";
  if (hint) hint.style.display = loggedIn ? "none" : "inline";
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
async function loadRelated() {
  const wrap = document.getElementById("related-list");
  const q = query(
    collection(db, "videos"),
    where("status", "==", "publish"),
    where("category", "==", videoData.category || ""),
    limit(6)
  );
  const snap = await getDocs(q);
  const items = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(v => v.id !== videoId);
  wrap.innerHTML = items.map(v => `
    <a href="watch.html?id=${v.id}" style="display:flex;gap:10px;text-decoration:none;color:inherit">
      <img src="${v.thumbnail}" style="width:120px;aspect-ratio:16/9;object-fit:cover;border-radius:6px" loading="lazy">
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

function renderCommentsList() {
  const list = document.getElementById("comment-list");
  const topLevel = allComments.filter(c => !c.parentId);
  const visible = topLevel.slice(0, commentDisplayLimit);

  list.innerHTML = visible.map(c => renderComment(c, allComments)).join("")
    || `<p style="color:var(--text-muted)">Belum ada komentar. Jadilah yang pertama!</p>`;

  if (topLevel.length > commentDisplayLimit) {
    const sisa = topLevel.length - commentDisplayLimit;
    list.innerHTML += `
      <button class="share-btn" id="btn-load-more-comments" style="width:100%;margin-top:10px">
        Muat lebih banyak (${sisa} lagi)
      </button>`;
  }

  const countEl = document.getElementById("comment-count");
  if (countEl) countEl.textContent = `${topLevel.length} komentar`;

  // Reposisi ulang kolom komentar kalau lagi zoom aktif dan daftar komentar
  // baru saja berubah tinggi (misal abis kirim komentar baru).
  if (commentZoomController && commentZoomController.isActive()) {
    commentZoomController.reposition();
  }
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

  return `
    <div class="comment-item">
      <img src="${c.userPhoto || 'https://via.placeholder.com/34'}" alt="">
      <div style="flex:1">
        <div style="font-size:.85rem;font-weight:600">${escapeHtml(c.userName || 'User')}
          <span style="font-weight:400;color:var(--text-muted);font-size:.72rem">· ${formatCommentDate(c.createdAt)}</span>
        </div>
        <div style="font-size:.85rem;margin:4px 0">${escapeHtml(c.text)}</div>
        <div style="display:flex;gap:14px;font-size:.72rem;color:var(--text-muted);align-items:center">
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
        ${isExpanded ? replies.map(r => {
          const rReaction = userReactions[r.id];
          const rIsOwner = currentUser && currentUser.uid === r.uid;
          return `
          <div style="margin-top:8px;padding-left:14px;border-left:2px solid var(--border)">
            <div style="font-size:.8rem;font-weight:600">${escapeHtml(r.userName)}
              <span style="font-weight:400;color:var(--text-muted);font-size:.7rem">· ${formatCommentDate(r.createdAt)}</span>
            </div>
            <div style="font-size:.8rem">${escapeHtml(r.text)}</div>
            <div style="display:flex;gap:12px;font-size:.7rem;color:var(--text-muted);margin-top:4px;align-items:center">
              ${renderReactionRow(r, rReaction)}
              <span style="cursor:pointer" data-reply="${c.id}" data-reply-name="${escapeHtml(r.userName||'User')}">Balas</span>
              ${rIsOwner ? `<span style="cursor:pointer" data-del="${r.id}">Hapus</span>` : ""}
            </div>
          </div>`;
        }).join("") : ""}
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

  btn.disabled = true;
  btn.textContent = "Mengirim...";
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
  } catch (err) {
    console.error("Gagal mengirim komentar:", err.message);
    alert("Komentar gagal terkirim. Coba lagi sebentar lagi.\n(" + err.message + ")");
    // Gagal kirim -> jangan ditutup, biarkan user coba lagi tanpa harus fokus ulang.
  } finally {
    btn.disabled = !currentUser;
    btn.textContent = "Kirim";
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
    if (expandedReplies.has(toggleId)) expandedReplies.delete(toggleId);
    else expandedReplies.add(toggleId);
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
      // writeBatch dipakai supaya perubahan dokumen reaksi + counter like/
      // dislike pada komentar tercatat sebagai SATU operasi atomik (bukan
      // dua request terpisah yang bisa "nyangkut" separuh jalan), sekaligus
      // tetap pakai increment() server-side biar aman dari race condition
      // saat banyak user bereaksi hampir bersamaan.
      const batch = writeBatch(db);

      if (prevType === type) {
        // klik ulang tombol yang sama -> batalkan reaksi
        const field = type === "like" ? "likeCount" : "dislikeCount";
        if (target) target[field] = Math.max((target[field] || 1) - 1, 0);
        delete userReactions[cid];
        batch.delete(reactRef);
        batch.update(commentRef, { [field]: increment(-1) });

      } else if (prevType) {
        // pindah dari like ke dislike (atau sebaliknya)
        const oldField = prevType === "like" ? "likeCount" : "dislikeCount";
        const newField = type === "like" ? "likeCount" : "dislikeCount";
        if (target) {
          target[oldField] = Math.max((target[oldField] || 1) - 1, 0);
          target[newField] = (target[newField] || 0) + 1;
        }
        userReactions[cid] = type;
        batch.set(reactRef, { commentId: cid, uid: currentUser.uid, type, videoId });
        batch.update(commentRef, { [oldField]: increment(-1), [newField]: increment(1) });

      } else {
        // belum pernah bereaksi -> reaksi baru
        const field = type === "like" ? "likeCount" : "dislikeCount";
        if (target) target[field] = (target[field] || 0) + 1;
        userReactions[cid] = type;
        batch.set(reactRef, { commentId: cid, uid: currentUser.uid, type, videoId });
        batch.update(commentRef, { [field]: increment(1) });
      }

      renderCommentsList(); // update tampilan optimis dulu
      await batch.commit();
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
const COMMENT_TEXTAREA_MIN_H = 44;   // ~2 baris
const COMMENT_TEXTAREA_MAX_H = 120;  // ~5 baris sebelum scroll sendiri
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
    input.addEventListener("input", () => autoGrowTextarea(input));
  }

  if (list) {
    list.style.setProperty("max-height", COMMENT_LIST_MAX_H, "important");
    list.style.setProperty("overflow-y", "auto", "important");
  }
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

// ---------- Section Komentar: tertutup by default ----------
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

(function setupCollapsibleCommentsSection() {
  const heading = findCommentHeading();
  const box = document.querySelector(".comment-box");
  const sortNewest = document.getElementById("sort-newest");
  const sortOldest = document.getElementById("sort-oldest");
  const list = document.getElementById("comment-list");
  if (!heading || !list) return;

  let expanded = false;

  heading.style.setProperty("cursor", "pointer", "important");
  heading.style.setProperty("user-select", "none", "important");
  heading.style.setProperty("display", "flex", "important");
  heading.style.setProperty("align-items", "center", "important");
  heading.style.setProperty("gap", "8px", "important");

  const arrow = document.createElement("span");
  arrow.textContent = "▾";
  arrow.style.fontSize = ".7em";
  arrow.style.transition = "transform .15s";
  heading.appendChild(arrow);

  function applyState() {
    const val = expanded ? "" : "none";
    if (box) box.style.setProperty("display", val, "important");
    if (sortNewest) sortNewest.style.setProperty("display", val, "important");
    if (sortOldest) sortOldest.style.setProperty("display", val, "important");
    list.style.setProperty("display", val, "important");
    arrow.style.transform = expanded ? "rotate(180deg)" : "rotate(0deg)";
  }

  heading.addEventListener("click", () => {
    expanded = !expanded;
    applyState();
  });

  applyState(); // mulai tertutup
})();

loadVideo();
