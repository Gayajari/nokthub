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
document.addEventListener("DOMContentLoaded", () => {
  const loginBtn = document.getElementById("login-btn");
  const profileBtn = document.getElementById("profile-btn");

  watchAuthState((user) => {
    if (user) {
      if (loginBtn) loginBtn.style.display = "none";
      if (profileBtn) {
        profileBtn.style.display = "flex";
        profileBtn.innerHTML = `
          <img src="${user.photoURL || 'https://via.placeholder.com/32'}" alt="">
          <span>${user.displayName || 'Profil'}</span>`;
      }
    } else {
      if (loginBtn) loginBtn.style.display = "inline-block";
      if (profileBtn) profileBtn.style.display = "none";
    }
  });

  if (loginBtn) loginBtn.addEventListener("click", () => {
    window.location.href = "login.html";
  });
  if (profileBtn) profileBtn.addEventListener("click", () => {
    window.location.href = "profile.html";
  });
});
