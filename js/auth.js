// ============================================================
// NOKT HUB — Authentication
// ============================================================
import {
  auth, db, googleProvider, onAuthStateChanged, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  sendPasswordResetEmail, sendEmailVerification, updateProfile,
  doc, setDoc, getDoc, serverTimestamp,
  setPersistence, browserLocalPersistence, browserSessionPersistence
} from "./firebase-config.js";

// ---------- Avatar default (untuk user yang daftar via email, tanpa foto Google) ----------
const DEFAULT_AVATARS = [
  "assets/default-avatars/avatar1.webp",
  "assets/default-avatars/avatar2.webp",
  "assets/default-avatars/avatar3.webp",
  "assets/default-avatars/avatar4.webp",
  "assets/default-avatars/avatar5.webp",
];

function pickRandomAvatar() {
  const i = Math.floor(Math.random() * DEFAULT_AVATARS.length);
  return DEFAULT_AVATARS[i];
}

async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    // Kalau user belum punya foto (daftar via email), pilihkan salah satu
    // avatar default secara acak. Kalau login via Google, photoURL dari
    // Google tetap dipakai apa adanya.
    const photoURL = user.photoURL || pickRandomAvatar();
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

// "Ingat saya" dicentang -> tetap login walau browser ditutup (localPersistence).
// Tidak dicentang -> logout otomatis begitu tab/browser ditutup (sessionPersistence).
// Panggil ini SEBELUM loginWithEmail() atau loginWithGoogle().
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

  // Pilih avatar default acak, lalu simpan ke PROFIL FIREBASE AUTH juga
  // (bukan cuma Firestore) supaya res.user.photoURL langsung terisi sejak
  // awal. Ini penting karena renderAuthUI() di navbar membaca photoURL
  // dari objek user Firebase Auth (via onAuthStateChanged), bukan dari
  // Firestore -- kalau cuma diisi di Firestore, navbar tetap akan pecah.
  const avatarURL = pickRandomAvatar();
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

// Render tombol Login / Profil ke DOM berdasarkan sebuah "state" ringkas:
// { loggedIn: true/false, displayName, photoURL }. Dipakai baik oleh versi
// cache (instan, dari localStorage) maupun versi asli (dari Firebase).
function renderAuthUI(loginBtn, profileBtn, state) {
  if (state.loggedIn) {
    if (loginBtn) loginBtn.style.display = "none";
    if (profileBtn) {
      profileBtn.style.display = "flex";
      // Fallback foto pakai salah satu avatar default milik sendiri
      // (bukan via.placeholder.com) -- lebih cepat dimuat & tidak
      // bergantung pada layanan pihak ketiga yang bisa lambat/mati.
      const photo = state.photoURL || DEFAULT_AVATARS[0];
      profileBtn.innerHTML = `
        <img src="${photo}" alt="" onerror="this.src='${DEFAULT_AVATARS[0]}'">
        <span>${state.displayName || 'Profil'}</span>`;
    }
  } else {
    if (loginBtn) loginBtn.style.display = "inline-block";
    if (profileBtn) profileBtn.style.display = "none";
  }
  // Munculkan lagi elemen yang sempat disembunyikan lewat script anti-flash
  // di <head> (lihat komentar "Anti-flash" di tiap file HTML).
  if (loginBtn) loginBtn.style.visibility = "visible";
  if (profileBtn) profileBtn.style.visibility = "visible";
}

// ---------- Terapkan status login dari cache dulu (instan) ----------
function applyCachedAuthState() {
  const loginBtn = document.getElementById("login-btn");
  const profileBtn = document.getElementById("profile-btn");
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem("nokt_auth_cache") || "null");
  } catch (e) { cached = null; }

  if (!cached) return; // belum ada cache (kunjungan pertama) -> biarkan tampilan default HTML apa adanya
  renderAuthUI(loginBtn, profileBtn, cached);
}

document.addEventListener("DOMContentLoaded", () => {
  const loginBtn = document.getElementById("login-btn");
  const profileBtn = document.getElementById("profile-btn");

  // 1) Terapkan dulu dari cache -> instan, minim kedip.
  applyCachedAuthState();

  // 2) Baru dengarkan status asli dari Firebase.
  watchAuthState((user) => {
    const state = user
      ? { loggedIn: true, displayName: user.displayName || "", photoURL: user.photoURL || "" }
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
