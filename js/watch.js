// ============================================================
// NOKT HUB — Watch Page Logic
// ============================================================
import {
  db, auth, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc,
  deleteDoc, query, where, orderBy, limit, increment, serverTimestamp,
  onAuthStateChanged, onSnapshot
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
  loadUserReactions(); // sinkronkan status like/dislike komentar sesuai user yang login
});

// Aktifkan/nonaktifkan kotak komentar sesuai status login.
// Sebelumnya textarea & tombol selalu aktif meski belum login (cuma placeholder
// yang bilang "harus login"), jadi user abis login pun tampilannya gak berubah.
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
  // countView() dipindah, sekarang dipanggil dari trackResumePosition setelah nonton 10 detik
  listenVideoStats(); // view/like update realtime tanpa reload
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
  document.getElementById("video-desc").textContent = v.description || "";
  document.getElementById("stat-views").textContent = `${(v.viewCount||0).toLocaleString('id-ID')} view`;
  document.getElementById("stat-likes").textContent = `${(v.likeCount||0).toLocaleString('id-ID')} like`;
  document.getElementById("stat-date").textContent = v.uploadedAt?.toDate
    ? v.uploadedAt.toDate().toLocaleDateString('id-ID') : "";

  document.getElementById("video-category").innerHTML =
    `<a class="cat-chip" href="category.html?c=${encodeURIComponent(v.category||'')}">${escapeHtml(v.category||'-')}</a>`;
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

// ---------- View counting: 1 per akun/anon-id per jendela waktu, setelah nonton minimal N detik ----------
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
      if (now - last < VIEW_WINDOW_MS) return; // sudah dihitung dalam 5 menit terakhir
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
    if (snap.exists()) { btn.classList.add("is-active"); return; } // sudah like
    await setDoc(likeRef, { videoId, uid: currentUser.uid });
    await updateDoc(doc(db, "videos", videoId), { likeCount: increment(1) });
    btn.classList.add("is-active");
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
let userReactions = {}; // { commentId: "like" | "dislike" }, dimuat sekali per login/video
let commentSortOrder = "desc"; // "desc" = terbaru dulu, "asc" = terlama dulu
let commentDisplayLimit = 8; // jumlah komentar yang ditampilkan awal, nambah tiap klik "Muat lebih banyak"
const COMMENT_BATCH_SIZE = 8;
let unsubscribeComments = null; // listener realtime komentar, diganti tiap kali sort order berubah

// Live listener: sekali dipasang, tiap ada komentar baru / like / dislike baru
// (dari siapa pun, tanpa perlu reload) daftar komentar otomatis update sendiri —
// sama seperti listenVideoStats() untuk view/like video.
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

// Render ulang dari data yang sudah ada di memori (allComments) — dipanggil tiap
// snapshot berubah maupun tiap klik "Muat lebih banyak", tanpa perlu fetch ulang
// ke Firestore, jadi ringan.
function renderCommentsList() {
  const list = document.getElementById("comment-list");
  const topLevel = allComments.filter(c => !c.parentId);
  const visible = topLevel.slice(0, commentDisplayLimit);

  list.innerHTML = visible.map(c => renderComment(c, allComments)).join("")
    || `<p style="color:var(--text-muted)">Belum ada komentar. Jadilah yang pertama!</p>`;

  // Tombol "Muat lebih banyak" — cuma muncul kalau masih ada komentar
  // yang belum ditampilkan, biar halaman gak jadi panjang terus ke bawah
  // sekaligus meski komentarnya ratusan.
  if (topLevel.length > commentDisplayLimit) {
    const sisa = topLevel.length - commentDisplayLimit;
    list.innerHTML += `
      <button class="share-btn" id="btn-load-more-comments" style="width:100%;margin-top:10px">
        Muat lebih banyak (${sisa} lagi)
      </button>`;
  }

  const countEl = document.getElementById("comment-count");
  if (countEl) countEl.textContent = `${topLevel.length} komentar`;
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
    commentDisplayLimit = COMMENT_BATCH_SIZE; // reset paging tiap ganti urutan
    document.querySelectorAll("#sort-newest, #sort-oldest").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    listenComments();
  });
});
document.getElementById("sort-newest").classList.add("active"); // default: terbaru dulu

// Ambil reaksi milik user saat ini untuk semua komentar, sekali per login/ganti video —
// BUKAN tiap snapshot berubah, supaya gak boros pembacaan Firestore.
async function loadUserReactions() {
  userReactions = {};
  if (!currentUser || !allComments.length) return;
  try {
    await Promise.all(allComments.map(async (c) => {
      const snap = await getDoc(doc(db, "comment_reactions", `${c.id}_${currentUser.uid}`));
      if (snap.exists()) userReactions[c.id] = snap.data().type;
    }));
  } catch (err) {
    console.error("Gagal memuat reaksi komentar:", err.message);
  }
  renderCommentsList();
}

function renderComment(c, all) {
  const replies = all.filter(r => r.parentId === c.id);
  const isOwner = currentUser && currentUser.uid === c.uid;
  const myReaction = userReactions[c.id];
  const likeActive = myReaction === "like" ? "is-active" : "";
  const dislikeActive = myReaction === "dislike" ? "is-active" : "";
  const disabledClass = myReaction ? "is-disabled" : "";
  return `
    <div class="comment-item">
      <img src="${c.userPhoto || 'https://via.placeholder.com/34'}" alt="">
      <div style="flex:1">
        <div style="font-size:.85rem;font-weight:600">${escapeHtml(c.userName || 'User')}</div>
        <div style="font-size:.85rem;margin:4px 0">${escapeHtml(c.text)}</div>
        <div style="display:flex;gap:14px;font-size:.72rem;color:var(--text-muted)">
          <span class="comment-react ${likeActive} ${disabledClass}" data-react="like" data-cid="${c.id}">${ICON_THUMB_UP} ${c.likeCount||0}</span>
          <span class="comment-react ${dislikeActive} ${disabledClass}" data-react="dislike" data-cid="${c.id}">${ICON_THUMB_DOWN} ${c.dislikeCount||0}</span>
          ${isOwner ? `<span style="cursor:pointer" data-del="${c.id}">Hapus</span>` : ""}
        </div>
        ${replies.map(r => `
          <div style="margin-top:8px;padding-left:14px;border-left:2px solid var(--border)">
            <div style="font-size:.8rem;font-weight:600">${escapeHtml(r.userName)}</div>
            <div style="font-size:.8rem">${escapeHtml(r.text)}</div>
          </div>`).join("")}
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
    // Tidak perlu panggil apa-apa lagi di sini — listener realtime (onSnapshot)
    // otomatis nangkep komentar baru ini dan langsung merender ulang daftar.
  } catch (err) {
    console.error("Gagal mengirim komentar:", err.message);
    alert("Komentar gagal terkirim. Coba lagi sebentar lagi.\n(" + err.message + ")");
  } finally {
    btn.disabled = !currentUser;
    btn.textContent = "Kirim";
  }
});

// Satu listener untuk hapus komentar DAN reaksi like/dislike
document.getElementById("comment-list").addEventListener("click", async (e) => {
  const delId = e.target.dataset.del;
  if (delId) {
    await deleteDoc(doc(db, "comments", delId));
    // Tidak perlu loadComments() manual — listener realtime otomatis update.
    return;
  }

  const reactEl = e.target.closest("[data-react]");
  if (reactEl) {
    if (!currentUser) { window.location.href = "login.html"; return; }
    if (reactEl.classList.contains("is-disabled")) return; // sudah pernah react, cegah double klik

    const cid = reactEl.dataset.cid;
    const type = reactEl.dataset.react; // "like" atau "dislike"
    const reactRef = doc(db, "comment_reactions", `${cid}_${currentUser.uid}`);
    try {
      const snap = await getDoc(reactRef);
      if (snap.exists()) return; // sudah pernah react sebelumnya
      // Update status "aktif" duluan di layar (optimistic) — biar tombol langsung
      // ke-lock begitu diklik, gak nunggu jaringan. Angka like/dislike-nya sendiri
      // akan update otomatis begitu listener realtime nangkep perubahan dari server.
      userReactions[cid] = type;
      renderCommentsList();
      await setDoc(reactRef, { commentId: cid, uid: currentUser.uid, type });
      await updateDoc(doc(db, "comments", cid), {
        [type === "like" ? "likeCount" : "dislikeCount"]: increment(1)
      });
    } catch (err) {
      console.error("Gagal menyimpan reaksi komentar:", err.message);
      delete userReactions[cid]; // gagal simpan, batalkan status aktif di layar
      renderCommentsList();
    }
  }
});

loadVideo();
