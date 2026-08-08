// ============================================================
// NOKT HUB — Authentication
// ============================================================
import {
  auth, db, googleProvider, onAuthStateChanged, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  sendPasswordResetEmail, sendEmailVerification, updateProfile,
  doc, setDoc, getDoc, serverTimestamp
} from "./firebase-config.js";

async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      name: user.displayName || "User",
      email: user.email,
      photoURL: user.photoURL || "",
      role: "user",
      emailVerified: user.emailVerified,
      createdAt: serverTimestamp()
    });
  }
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
  await updateProfile(res.user, { displayName: name });
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
      profileBtn.innerHTML = `
        <img src="${state.photoURL || 'https://via.placeholder.com/32'}" alt="">
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
// Sama seperti mekanisme nama/warna situs: supaya pengunjung yang sudah
// pernah buka situs ini sebelumnya langsung lihat tampilan Login/Profil
// yang (kemungkinan besar) benar, tanpa nunggu Firebase selesai memeriksa
// status login — yang biasanya makan waktu sepersekian detik dan bikin
// tombol "Login" sempat kelihatan kedip sebelum berubah jadi profil
// (atau sebaliknya).
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

  // 2) Baru dengarkan status asli dari Firebase. Begitu didapat, render
  //    ulang (mengonfirmasi/mengoreksi hasil cache) dan simpan ke cache
  //    lagi untuk kunjungan berikutnya.
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
