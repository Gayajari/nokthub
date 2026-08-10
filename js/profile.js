// ============================================================
// NOKT HUB — Halaman Profil
// ============================================================
import { db, doc, getDoc, updateDoc, updateProfile as fbUpdateProfile } from "./firebase-config.js";
import { watchAuthState, logout, getAvatarForUid, DEFAULT_AVATARS } from "./auth.js";

let currentUser = null;

// ---------- Avatar fallback ----------
// Kalau user tidak punya foto profil sama sekali (mis. daftar pakai email),
// avatar diambil dari 5 avatar default kita SENDIRI (file lokal di
// assets/default-avatars/), dipilih konsisten berdasarkan uid -- BUKAN
// dari layanan luar (ui-avatars.com) seperti sebelumnya. Ini lebih cepat
// dimuat dan tidak tergantung layanan pihak ketiga yang bisa lambat/gagal.
function avatarFallbackUrl(uid) {
  return uid ? getAvatarForUid(uid) : DEFAULT_AVATARS[0];
}

// ---------- Terapkan dari cache dulu (instan, minim kedip) ----------
function applyCachedAuthToProfileSections() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem("nokt_auth_cache") || "null"); } catch (e) { cached = null; }

  const guestSection = document.getElementById("profile-guest");
  const loggedSection = document.getElementById("profile-logged");
  if (!cached) return;

  if (cached.loggedIn) {
    if (guestSection) guestSection.style.display = "none";
    if (loggedSection) {
      loggedSection.style.display = "block";
      const avatarEl = document.getElementById("profile-avatar");
      if (avatarEl) {
        avatarEl.src = cached.photoURL || avatarFallbackUrl(cached.uid);
        avatarEl.onerror = () => { avatarEl.onerror = null; avatarEl.src = DEFAULT_AVATARS[0]; };
      }
      const nameInput = document.getElementById("profile-name-input");
      if (nameInput) nameInput.value = cached.displayName || "";
    }
  } else {
    if (guestSection) guestSection.style.display = "block";
    if (loggedSection) loggedSection.style.display = "none";
  }
}

async function renderLoggedInProfile(user) {
  currentUser = user;

  const guestSection = document.getElementById("profile-guest");
  const loggedSection = document.getElementById("profile-logged");
  if (guestSection) guestSection.style.display = "none";
  if (loggedSection) loggedSection.style.display = "block";

  const avatarEl = document.getElementById("profile-avatar");
  const nameInput = document.getElementById("profile-name-input");
  const emailEl = document.getElementById("profile-email");
  const verifiedEl = document.getElementById("profile-verified");
  const joinedEl = document.getElementById("profile-joined");

  if (avatarEl) {
    avatarEl.src = user.photoURL || avatarFallbackUrl(user.uid);
    // Jaga-jaga kalau photoURL dari Google/lama ternyata rusak/mati juga
    avatarEl.onerror = () => { avatarEl.onerror = null; avatarEl.src = DEFAULT_AVATARS[0]; };
  }
  if (nameInput) nameInput.value = user.displayName || "";
  if (emailEl) emailEl.value = user.email || "";
  if (verifiedEl) {
    verifiedEl.textContent = user.emailVerified ? "✓ Email terverifikasi" : "Email belum terverifikasi";
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const data = snap.data();
      // Kalau Firestore ternyata punya photoURL tapi Firebase Auth belum
      // (mis. akun lama sebelum migrasi), pakai yang dari Firestore.
      if (avatarEl && !user.photoURL && data.photoURL) {
        avatarEl.src = data.photoURL;
      }
      if (joinedEl && data.createdAt && data.createdAt.toDate) {
        joinedEl.textContent = "Bergabung sejak " + data.createdAt.toDate().toLocaleDateString("id-ID", {
          year: "numeric", month: "long", day: "numeric"
        });
      }
    }
  } catch (e) { /* biarkan kosong kalau gagal ambil data tambahan, bukan error fatal */ }
}

function renderGuestProfile() {
  currentUser = null;
  const guestSection = document.getElementById("profile-guest");
  const loggedSection = document.getElementById("profile-logged");
  if (guestSection) guestSection.style.display = "block";
  if (loggedSection) loggedSection.style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
  applyCachedAuthToProfileSections();

  watchAuthState((user) => {
    if (user) renderLoggedInProfile(user);
    else renderGuestProfile();
  });

  const saveBtn = document.getElementById("profile-save-btn");
  const msg = document.getElementById("profile-msg");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      if (!currentUser) return;
      const nameInput = document.getElementById("profile-name-input");
      const newName = nameInput.value.trim();
      if (!newName) { msg.textContent = "Nama tidak boleh kosong."; return; }

      msg.textContent = "Menyimpan...";
      try {
        await fbUpdateProfile(currentUser, { displayName: newName });
        await updateDoc(doc(db, "users", currentUser.uid), { name: newName });

        try {
          const cached = JSON.parse(localStorage.getItem("nokt_auth_cache") || "null") || {};
          cached.displayName = newName;
          localStorage.setItem("nokt_auth_cache", JSON.stringify(cached));
        } catch (e) {}

        msg.textContent = "Nama berhasil diperbarui.";
      } catch (err) {
        msg.textContent = "Gagal menyimpan: " + err.message;
      }
    });
  }

  const logoutBtn = document.getElementById("profile-logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await logout();
      try { localStorage.setItem("nokt_auth_cache", JSON.stringify({ loggedIn: false })); } catch (e) {}
      window.location.href = "index.html";
    });
  }
});
