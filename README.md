# NOKT HUB — Panduan Setup

## 1. Firebase
1. Buat project di https://console.firebase.google.com
2. Aktifkan **Authentication** → Sign-in method: Google + Email/Password.
3. Aktifkan **Firestore Database** (mode production).
4. Buka `js/firebase-config.js`, ganti `firebaseConfig` dengan config project kamu
   (Project Settings → Your apps → Web app).
5. Deploy `firestore.rules` ke Firestore (Firebase Console → Firestore → Rules,
   atau `firebase deploy --only firestore:rules` via Firebase CLI).

## 2. Jadikan akun pertama sebagai admin
Setelah register/login sekali di website, buka Firestore Console →
koleksi `users` → dokumen dengan uid kamu → ubah field `role` dari `"user"`
menjadi `"admin"`. Setelah itu kamu bisa akses `/admin/dashboard.html`.

## 3. Provider video yang didukung (legal & aman)
Player universal (`js/player.js`) otomatis mendeteksi:
- **YouTube** (youtube.com / youtu.be)
- **Vimeo**
- **Google Drive** (link share file)
- **MP4/WebM/OGG langsung** (file yang kamu hosting sendiri, mis. Firebase
  Storage, Vercel Blob, atau CDN milikmu)
- **Iframe generic** — fallback untuk provider lain yang secara resmi
  mengizinkan embedding kontenmu sendiri.

Situs ini **sengaja tidak** menyertakan whitelist untuk situs-situs seperti
Doodstream/Vidoy/Vidara.io dkk karena mayoritas konten di host tersebut
adalah materi berhak cipta tanpa izin. Gunakan video milikmu sendiri atau
video berlisensi resmi.

## 4. Deploy ke Vercel
1. Push folder ini ke GitHub.
2. Import repo di https://vercel.com/new — tidak perlu build command
   (situs ini static HTML/CSS/JS murni).
3. Root directory: folder project ini.

## 5. Struktur file
```
index.html          → Homepage
watch.html           → Halaman tonton video
category.html        → Listing per kategori
tag.html              → Listing per tag
search.html           → Hasil pencarian
latest.html/popular.html → Listing lengkap + pagination
login.html            → Login/register
admin/dashboard.html  → Panel admin (upload/kelola video)
js/                   → Semua logic (firebase-config, app, auth, player,
                         watch, listing, admin, categories)
css/style.css         → Semua styling
firestore.rules       → Security rules Firestore
manifest.json         → PWA manifest
vercel.json           → Config hosting Vercel
```

## 6. Yang masih perlu kamu lengkapi
- Sitemap.xml & robots.txt otomatis (bisa digenerate via Cloud Function
  yang membaca koleksi `videos`, karena situs ini fully static di Vercel).
- Halaman profil user lengkap (ganti foto, edit nama) — kerangka fungsi
  sudah ada di `js/auth.js` (`updateProfile`), tinggal dibuatkan UI-nya.
  Watch Later, Playlist, Favorite — koleksi `favorites`/`history` sudah
  disiapkan di skema, tinggal dibuatkan UI listing-nya.
- Halaman edit video di admin (saat ini hanya create + delete dari tabel;
  tombol "Edit" perlu form terpisah yang memanggil `updateDoc`).
