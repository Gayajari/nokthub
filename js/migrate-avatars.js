// ============================================================
// NOKT HUB — Migrasi Avatar Default (jalankan SEKALI SAJA)
// ============================================================
// Tujuan: mengisi field `photoURL` di Firestore untuk semua user LAMA
// yang photoURL-nya masih kosong (biasanya user yang daftar via email
// sebelum fitur avatar default ini dipasang).
//
// CARA PAKAI:
// 1. Import & panggil migrateEmptyAvatars() dari halaman admin
//    (misal lewat tombol khusus di admin.html, atau lewat console
//    browser saat login sebagai admin).
// 2. Jalankan HANYA SEKALI. Setelah semua user lama sudah punya
//    photoURL, script ini tidak akan mengubah apa-apa lagi kalau
//    dijalankan ulang (aman, idempotent -- karena hanya menyentuh
//    dokumen yang photoURL-nya masih kosong).
//
// CATATAN: ini hanya mengisi field di Firestore (koleksi "users"),
// BUKAN photoURL di Firebase Authentication milik user lain -- itu
// tidak bisa diubah dari client untuk akun orang lain (perlu Admin SDK
// di server). Tapi karena semua tampilan foto profil di web ini
// (navbar, halaman profile, dst) sebaiknya membaca dari Firestore
// sebagai sumber utama, ini sudah cukup untuk memperbaiki tampilan.
// ============================================================

import { db, collection, getDocs, doc, updateDoc } from "./firebase-config.js";
import { getAvatarForUid } from "./auth.js";

export async function migrateEmptyAvatars() {
  const snap = await getDocs(collection(db, "users"));
  let updated = 0;
  let skipped = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (!data.photoURL || data.photoURL.trim() === "") {
      const avatarURL = getAvatarForUid(docSnap.id); // docSnap.id = uid
      await updateDoc(doc(db, "users", docSnap.id), { photoURL: avatarURL });
      updated++;
      console.log(`✅ ${data.name || docSnap.id} -> ${avatarURL}`);
    } else {
      skipped++;
    }
  }

  console.log(`Selesai. ${updated} user diperbarui, ${skipped} user sudah punya foto (dilewati).`);
  return { updated, skipped };
}