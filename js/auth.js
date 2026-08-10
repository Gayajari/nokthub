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
export const DEFAULT_AVATARS = [
  "avatar1.webp",
  "avatar2.webp",
  "avatar3.webp",
  "avatar4.webp",
  "avatar5.webp",
];

// Pilih avatar SECARA KONSISTEN berdasarkan uid -- 1 user akan selalu
// dapat avatar yang sama setiap kali (bukan ganti-ganti tiap refresh),
// tanpa perlu nyimpen index-nya secara terpisah. Dipakai baik untuk user
// baru (saat daftar) maupun sebagai fallback tampilan untuk user lama yang
// datanya belum punya photoURL sama sekali.
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

  // Avatar dipilih konsisten dari uid, lalu disimpan ke profil Firebase
  // Auth juga -- supaya res.user.photoURL langsung terisi sejak awal.
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
      // Kalau photoURL kosong (user lama sebelum fitur ini ada), pakai
      // avatar konsisten berdasarkan uid -- bukan avatar acak tiap render.
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
