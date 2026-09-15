// ============================================================
// NOKT HUB — Migrasi Avatar Default (jalankan SEKALI SAJA)
// ============================================================
import { db, collection, getDocs, doc, updateDoc, getAvatarForUid } from "./core.js";

export async function migrateEmptyAvatars() {
  const snap = await getDocs(collection(db, "users"));
  let updated = 0;
  let skipped = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (!data.photoURL || data.photoURL.trim() === "") {
      const avatarURL = getAvatarForUid(docSnap.id);
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
