// ============================================================
// NOKT HUB — Core (Firebase + Auth + Icons + Supabase Thumbnail Backup)
// ============================================================
// File ini GABUNGAN dari beberapa bagian:
//   - firebase-config.js (koneksi & export Firebase)
//   - auth.js            (login/daftar/logout, avatar default,
//                          binding tombol Login/Profil di navbar)
//   - icons.js           (pustaka ikon kategori)
//   - supabase-thumb.js  (BARU: backup thumbnail ke Supabase Storage,
//                          dipakai BARENG ImgBB, bukan pengganti)
// Digabung supaya lebih sedikit file yang perlu dibuka-tutup saat
// maintenance -- fungsi lama PERSIS SAMA seperti sebelumnya, cuma
// ditambah bagian Supabase di bawah.
// ============================================================

// ---------- 1. FIREBASE SETUP ----------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged,
  signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, sendEmailVerification, updateProfile,
  setPersistence, browserLocalPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc,
  deleteDoc, query, where, orderBy, limit, startAfter, onSnapshot,
  increment, serverTimestamp, Timestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAE8trK37zYX9wK2kyS0HOekB4iDiJHABc",
  authDomain: "nokt-hub.firebaseapp.com",
  projectId: "nokt-hub",
  storageBucket: "nokt-hub.firebasestorage.app",
  messagingSenderId: "513126228477",
  appId: "1:513126228477:web:7464f06839e7f7ea8f3994",
  measurementId: "G-43WH4M83ZC"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export {
  onAuthStateChanged, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, sendPasswordResetEmail,
  sendEmailVerification, updateProfile,
  setPersistence, browserLocalPersistence, browserSessionPersistence,
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, startAfter, onSnapshot,
  increment, serverTimestamp, Timestamp, deleteField
};

// ============================================================
// SKEMA KOLEKSI FIRESTORE (referensi)
// ============================================================
// users            { uid, name, email, photoURL, role: "user"|"admin",
//                    createdAt, emailVerified }
// videos           { title, slug, description, category, tags: [],
//                    thumbnail, thumbnail_supabase, supabase_file_path,
//                    embedUrl, embedType, status: "draft"|"publish",
//                    uploadedAt, adminName, seoTitle, seoDescription,
//                    metaKeywords, viewCount, likeCount, shareCount,
//                    searchTagCount, popularScore }
//   -> thumbnail            : URL thumbnail utama (ImgBB / host lain)
//   -> thumbnail_supabase   : URL publik thumbnail cadangan (Supabase)
//   -> supabase_file_path   : nama file di bucket Supabase (utk hapus)
//      Dua field ini bisa TIDAK ADA pada dokumen lama -- selalu akses
//      dengan fallback "|| ''" / "|| null", jangan anggap selalu ada.
// categories       { name, slug, videoCount, icon? }
// tags             { name, slug, searchCount, videoCount }
// comments         { videoId, uid, userName, userPhoto, text, parentId,
//                    likeCount, dislikeCount, createdAt }
// views            { videoId, uid, viewedAt }
// likes            { videoId, uid }
// shares           { videoId, uid, platform, sharedAt }
// favorites        { uid, videoId, addedAt }
// history          { uid, videoId, lastPosition, watchedAt }
// search_logs      { term, uid, searchedAt }
// reports          { videoId, uid, reason, createdAt }
// settings         { siteName, logoUrl, favicon, themeColor, footerText,
//                    socialLinks, contactEmail, gaId, gscVerification,
//                    hideCategoryIcons }
// notifications    { uid, title, message, read, createdAt }
// ============================================================


// ---------- 1.5 SUPABASE SETUP (thumbnail backup) ----------
// Dipakai BARENG ImgBB (thumbnail utama), bukan pengganti. Firestore
// tetap jadi database utama -- Supabase Storage cuma tempat simpan
// file cadangan thumbnail.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// TODO ISI INI: ambil dari Supabase Dashboard -> Project Settings -> API.
// - url     : "Project URL"
// - anonKey : "anon public" key (BUKAN "service_role" -- jangan pernah
//             taruh service_role key di kode frontend/browser).
// - bucket  : nama bucket Storage tempat thumbnail cadangan disimpan.
//             Buat dulu bucket ini di Supabase Dashboard -> Storage,
//             set "Public bucket" = ON supaya thumbnail bisa diakses
//             langsung lewat <img src="..."> di website.
const supabaseConfig = {
  url: "https://rfojevxjykqgdmpmtlrp.supabase.co",
  anonKey: "sb_publishable_qMIcV6-7Ub0f-7e3HECC7Q_Yg-Ajllt",
  bucket: "thumbnails"
};

export const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey);
export const SUPABASE_THUMBNAIL_BUCKET = supabaseConfig.bucket;

// ---------- Upload thumbnail cadangan ke Supabase Storage ----------
// Terima File atau Blob apa saja (tidak ada validasi/batas ukuran --
// semua file diproses dengan cara yang sama, sesuai keputusan produk).
// Mengembalikan { url, path }:
//   - url  -> disimpan sebagai field "thumbnail_supabase" di Firestore
//   - path -> disimpan sebagai field "supabase_file_path", dipakai
//             untuk menghapus file ini nanti (saat thumbnail diganti
//             atau video dihapus).
export async function uploadThumbnailToSupabase(fileOrBlob, originalName = "thumbnail.jpg") {
  const rawExt = (originalName.split(".").pop() || "jpg").toLowerCase();
  const safeExt = /^[a-z0-9]+$/.test(rawExt) ? rawExt : "jpg";
  // Nama file unik (timestamp + random) supaya tidak ada tabrakan nama
  // antar-upload, sesuai permintaan "buat nama/path file yang unik".
  const uniquePath = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${safeExt}`;

  const { error: uploadError } = await supabase
    .storage
    .from(SUPABASE_THUMBNAIL_BUCKET)
    .upload(uniquePath, fileOrBlob, {
      cacheControl: "3600",
      upsert: false,
      contentType: fileOrBlob.type || "image/jpeg"
    });

  if (uploadError) {
    throw new Error("Upload Supabase gagal: " + uploadError.message);
  }

  const { data: publicUrlData } = supabase
    .storage
    .from(SUPABASE_THUMBNAIL_BUCKET)
    .getPublicUrl(uniquePath);

  return { url: publicUrlData.publicUrl, path: uniquePath };
}

// ---------- Hapus thumbnail cadangan dari Supabase Storage ----------
// Aman dipanggil dengan path kosong/null/undefined -- langsung return
// tanpa error, supaya kompatibel dengan dokumen video lama yang belum
// punya field "supabase_file_path".
export async function deleteThumbnailFromSupabase(path) {
  if (!path) return;
  const { error } = await supabase
    .storage
    .from(SUPABASE_THUMBNAIL_BUCKET)
    .remove([path]);
  if (error) {
    // Dilempar lagi (bukan ditelan diam-diam) supaya pemanggil bisa
    // memberi tahu admin secara eksplisit kalau file backup mungkin
    // masih tertinggal di Supabase.
    throw new Error("Hapus file Supabase gagal: " + error.message);
  }
}


// ---------- 2. AUTHENTICATION ----------

export const DEFAULT_AVATARS = [
  "assets/avatars/avatar1.webp",
  "assets/avatars/avatar2.webp",
  "assets/avatars/avatar3.webp",
  "assets/avatars/avatar4.webp",
  "assets/avatars/avatar5.webp",
];

// Pilih avatar SECARA KONSISTEN berdasarkan uid -- 1 user akan selalu
// dapat avatar yang sama setiap kali (bukan ganti-ganti tiap refresh).
export function getAvatarForUid(uid) {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  }
  return DEFAULT_AVATARS[hash % DEFAULT_AVATARS.length];
}

async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const photoURL = user.photoURL || getAvatarForUid(user.uid);
    await setDoc(ref, {
      uid: user.uid,
      name: user.displayName || "User",
      email: user.email,
      photoURL,
      role: "user",
      emailVerified: user.emailVerified,
      createdAt: serverTimestamp()
    });
  }
}

export async function setLoginPersistence(remember) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
}

export async function loginWithGoogle() {
  const res = await signInWithPopup(auth, googleProvider);
  await ensureUserDoc(res.user);
  return res.user;
}

export async function loginWithEmail(email, password) {
  const res = await signInWithEmailAndPassword(auth, email, password);
  return res.user;
}

export async function registerWithEmail(email, password, name) {
  const res = await createUserWithEmailAndPassword(auth, email, password);
  const avatarURL = getAvatarForUid(res.user.uid);
  await updateProfile(res.user, { displayName: name, photoURL: avatarURL });
  await sendEmailVerification(res.user);
  await ensureUserDoc(res.user);
  return res.user;
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function logout() {
  await signOut(auth);
}

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, (user) => callback(user));
}

// ---------- Header UI binding (dipakai di semua halaman) ----------

function renderAuthUI(loginBtn, profileBtn, state) {
  if (state.loggedIn) {
    if (loginBtn) loginBtn.style.display = "none";
    if (profileBtn) {
      profileBtn.style.display = "flex";
      const photo = state.photoURL || (state.uid ? getAvatarForUid(state.uid) : DEFAULT_AVATARS[0]);
      profileBtn.innerHTML = `
        <img src="${photo}" alt="" onerror="this.src='${DEFAULT_AVATARS[0]}'">
        <span>${state.displayName || 'Profil'}</span>`;
    }
  } else {
    if (loginBtn) loginBtn.style.display = "inline-block";
    if (profileBtn) profileBtn.style.display = "none";
  }
  if (loginBtn) loginBtn.style.visibility = "visible";
  if (profileBtn) profileBtn.style.visibility = "visible";
}

function applyCachedAuthState() {
  const loginBtn = document.getElementById("login-btn");
  const profileBtn = document.getElementById("profile-btn");
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem("nokt_auth_cache") || "null");
  } catch (e) { cached = null; }

  if (!cached) return;
  renderAuthUI(loginBtn, profileBtn, cached);
}

document.addEventListener("DOMContentLoaded", () => {
  const loginBtn = document.getElementById("login-btn");
  const profileBtn = document.getElementById("profile-btn");

  applyCachedAuthState();

  watchAuthState((user) => {
    const state = user
      ? { loggedIn: true, uid: user.uid, displayName: user.displayName || "", photoURL: user.photoURL || "" }
      : { loggedIn: false };

    try { localStorage.setItem("nokt_auth_cache", JSON.stringify(state)); } catch (e) {}

    renderAuthUI(loginBtn, profileBtn, state);
  });

  if (loginBtn) loginBtn.addEventListener("click", () => {
    window.location.href = "login.html";
  });
  if (profileBtn) profileBtn.addEventListener("click", () => {
    window.location.href = "profile.html";
  });
});


// ---------- 3. IKON KATEGORI ----------

export const ICON_LIBRARY = {
  none:     { label: "Tanpa Ikon (kategori ini saja)", svg: "" },
  globe:    { label: "Semua/Umum",     svg: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>` },
  football: { label: "Olahraga",       svg: `<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18"/>` },
  sparkle:  { label: "Kecantikan",     svg: `<path d="M12 3v3M12 18v3M5 12H2M22 12h-3M6.3 6.3 4.2 4.2M19.8 19.8l-2.1-2.1M6.3 17.7l-2.1 2.1M19.8 4.2l-2.1 2.1"/><circle cx="12" cy="12" r="4"/>` },
  music:    { label: "Musik",          svg: `<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>` },
  gamepad:  { label: "Game",           svg: `<path d="M6 12h4m-2-2v4M17.5 12h.01M15 10h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.6l-.9 9A2 2 0 0 0 3.79 20a2.5 2.5 0 0 0 2.2-1.3l.7-1.4a2 2 0 0 1 1.8-1.1h7.02a2 2 0 0 1 1.8 1.1l.7 1.4a2.5 2.5 0 0 0 2.2 1.3 2 2 0 0 0 1.99-2.4l-.9-9A4 4 0 0 0 17.32 5Z"/>` },
  camera:   { label: "Vlog",           svg: `<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M22 8.5v7l-6-3.5 6-3.5Z"/>` },
  smile:    { label: "Komedi",         svg: `<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>` },
  trending: { label: "Trending",       svg: `<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>` },
  heart:    { label: "Romantis",       svg: `<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/>` },
  book:     { label: "Edukasi",        svg: `<path d="M2 3h20v14H2z"/><path d="M8 21h8M12 17v4"/>` },
  megaphone:{ label: "Berita",         svg: `<path d="M3 11 18 5v14L3 13"/><path d="M11 13v6a2 2 0 0 1-4 0v-5"/>` },
  food:     { label: "Kuliner",        svg: `<path d="M3 2v7c0 1.1.9 2 2 2s2-.9 2-2V2M5 11v11M15 2c-1.7 0-3 2.7-3 6s1.3 6 3 6v9"/>` },
  compass:  { label: "Travel",         svg: `<circle cx="12" cy="12" r="9"/><path d="m14.5 9.5-1.8 5.2-5.2 1.8 1.8-5.2z"/>` },
  bolt:     { label: "Aksi/Umum",      svg: `<path d="M13 2 3 14h8l-1 8 10-12h-8l1-8Z"/>` },
  film:     { label: "Film/Umum",      svg: `<path d="M2 3h20v14H2z"/><path d="M8 21h8M12 17v4M2 8h20M7 3v5M17 3v5"/>` },
  ghost:    { label: "Horror",         svg: `<path d="M9 10h.01M15 10h.01"/><path d="M12 3a7 7 0 0 0-7 7v9l2.5-2 2.5 2 2-2 2 2 2.5-2 2.5 2v-9a7 7 0 0 0-7-7Z"/>` },
  rocket:   { label: "Sci-Fi",         svg: `<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>` },
  baby:     { label: "Anak-anak",      svg: `<circle cx="12" cy="8" r="4"/><path d="M6 21v-2a6 6 0 0 1 12 0v2"/>` },
  crown:    { label: "Premium/Eksklusif", svg: `<path d="m2 20 2-10 5 4 3-7 3 7 5-4 2 10Z"/>` },
  live:     { label: "Live/Siaran",    svg: `<circle cx="12" cy="12" r="3"/><path d="M7 8.5a6.5 6.5 0 0 0 0 7M17 8.5a6.5 6.5 0 0 1 0 7M4 5a11 11 0 0 0 0 14M20 5a11 11 0 0 1 0 14"/>` },
  tool:     { label: "DIY/Tutorial Kerja", svg: `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>` },
  shirt:    { label: "Fashion",        svg: `<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23Z"/>` },
  cpu:      { label: "Teknologi",      svg: `<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>` },
  drama:    { label: "Drama",          svg: `<path d="M12 3v18M3 12h18M6.3 6.3l11.4 11.4M17.7 6.3 6.3 17.7"/><circle cx="12" cy="12" r="9"/>` },
};

const ICON_IDS = Object.keys(ICON_LIBRARY);

const KEYWORD_MAP = [
  { icon: "football",  match: ["bola", "sport", "olahraga", "futsal", "basket"] },
  { icon: "sparkle",   match: ["cantik", "kecantikan", "beauty", "makeup", "skincare"] },
  { icon: "music",     match: ["musik", "music", "lagu", "song"] },
  { icon: "gamepad",   match: ["game", "gaming", "play", "main"] },
  { icon: "camera",    match: ["vlog", "vlogger", "daily", "keseharian"] },
  { icon: "smile",     match: ["komedi", "lucu", "funny", "comedy", "meme"] },
  { icon: "trending",  match: ["trending", "viral", "populer", "hot"] },
  { icon: "heart",     match: ["romantis", "cinta", "love", "couple", "pacar"] },
  { icon: "book",      match: ["edukasi", "tutorial", "belajar", "education", "sekolah"] },
  { icon: "megaphone", match: ["berita", "news", "info", "informasi"] },
  { icon: "food",      match: ["masak", "kuliner", "makan", "food", "resep"] },
  { icon: "compass",   match: ["travel", "wisata", "jalan", "liburan"] },
  { icon: "ghost",     match: ["horror", "horor", "seram", "hantu"] },
  { icon: "rocket",    match: ["scifi", "sci-fi", "luar angkasa", "space", "fiksi ilmiah"] },
  { icon: "baby",      match: ["anak", "kids", "balita", "parenting"] },
  { icon: "crown",     match: ["premium", "eksklusif", "vip", "exclusive"] },
  { icon: "live",      match: ["live", "siaran", "langsung"] },
  { icon: "tool",      match: ["diy", "kerajinan", "renovasi", "perbaikan"] },
  { icon: "shirt",     match: ["fashion", "outfit", "baju", "style"] },
  { icon: "cpu",       match: ["teknologi", "tech", "gadget", "komputer"] },
  { icon: "drama",     match: ["drama", "sinetron", "series", "serial"] },
];

function matchKeywordIcon(name) {
  const lower = (name || "").toLowerCase();
  const found = KEYWORD_MAP.find(entry => entry.match.some(k => lower.includes(k)));
  return found ? found.icon : null;
}

function hashIcon(name) {
  const str = name || "";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  const neutralIds = ["globe", "bolt", "film"];
  return neutralIds[hash % neutralIds.length];
}

export function resolveCategoryIcon(cat) {
  if (cat && (cat.icon === "none" || (cat.icon && ICON_LIBRARY[cat.icon]))) {
    return cat.icon;
  }
  const keywordMatch = matchKeywordIcon(cat?.name);
  if (keywordMatch) return keywordMatch;
  return hashIcon(cat?.name || cat?.slug || "");
}

export function iconSvg(iconId) {
  if (iconId === "none") return "";
  const entry = ICON_LIBRARY[iconId] || ICON_LIBRARY.globe;
  if (!entry.svg) return "";
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${entry.svg}</svg>`;
}

export function allIconIds() {
  return ICON_IDS;
}

export function areIconsGloballyHidden() {
  try {
    const cached = JSON.parse(localStorage.getItem("nokt_settings_cache") || "null");
    return !!(cached && cached.hideCategoryIcons);
  } catch (e) {
    return false;
  }
}
