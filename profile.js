// ============================================================
// NOKT HUB — Halaman Profil
// ============================================================
import { db, doc, getDoc, updateDoc, updateProfile as fbUpdateProfile } from "./firebase-config.js";
import { watchAuthState, logout } from "./auth.js";

let currentUser = null;

// ---------- Avatar fallback ----------
// Kalau user tidak punya foto profil sama sekali (mis. daftar pakai
// email, bukan Google), avatar dibuatkan OTOMATIS dari inisial nama
// lewat layanan gratis ui-avatars.com — di-generate langsung oleh
// layanan itu tiap kali diminta, TIDAK disimpan di server kita sama
// sekali. Jadi baik ada foto (dari Google) maupun tidak ada foto sama
// sekali, tidak menambah beban penyimpanan di pihak kita.
function avatarFallbackUrl(name, email) {
  const label = (name || email || "U").trim();
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(label)}&background=random&color=fff&size=128`;
}

// ---------- Terapkan dari cache dulu (instan, minim kedip) ----------
// Memakai cache "nokt_auth_cache" yang sama dengan yang dipakai header
// login/profil di semua halaman (lihat js/auth.js).
function applyCachedAuthToProfileSections() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem("nokt_auth_cache") || "null"); } catch (e) { cached = null; }

  const guestSection = document.getElementById("profile-guest");
  const loggedSection = document.getElementById("profile-logged");
  if (!cached) return; // belum ada cache -> tunggu konfirmasi asli dari Firebase

  if (cached.loggedIn) {
    if (guestSection) guestSection.style.display = "none";
    if (loggedSection) {
      loggedSection.style.display = "block";
      const avatarEl = document.getElementById("profile-avatar");
      if (avatarEl) avatarEl.src = cached.photoURL || avatarFallbackUrl(cached.displayName, "");
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

  if (avatarEl) avatarEl.src = user.photoURL || avatarFallbackUrl(user.displayName, user.email);
  if (nameInput) nameInput.value = user.displayName || "";
  if (emailEl) emailEl.value = user.email || "";
  if (verifiedEl) {
    verifiedEl.textContent = user.emailVerified ? "✓ Email terverifikasi" : "Email belum terverifikasi";
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists() && joinedEl) {
      const created = snap.data().createdAt;
      if (created && created.toDate) {
        joinedEl.textContent = "Bergabung sejak " + created.toDate().toLocaleDateString("id-ID", {
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
  // 1) Cache dulu -> instan
  applyCachedAuthToProfileSections();

  // 2) Konfirmasi dari Firebase (sekaligus update cache lewat auth.js)
  watchAuthState((user) => {
    if (user) renderLoggedInProfile(user);
    else renderGuestProfile();
  });

  // ---------- Simpan perubahan nama ----------
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

        // Sinkronkan cache supaya header (login-btn/profile-btn) di halaman
        // lain juga langsung menampilkan nama baru tanpa nunggu Firebase lagi.
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

  // ---------- Logout ----------
  const logoutBtn = document.getElementById("profile-logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await logout();
      try { localStorage.setItem("nokt_auth_cache", JSON.stringify({ loggedIn: false })); } catch (e) {}
      window.location.href = "index.html";
    });
  }
});
