// ============================================================
// NOKT HUB — Firebase Configuration
// ============================================================
// 1. Buat project di https://console.firebase.google.com
// 2. Aktifkan: Authentication (Google + Email/Password),
//    Firestore Database, dan (opsional) Storage.
// 3. Salin config project kamu ke bawah ini.
// ============================================================

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
//                    thumbnail, embedUrl, embedType, status: "draft"|"publish",
//                    uploadedAt, adminName, seoTitle, seoDescription,
//                    metaKeywords, viewCount, likeCount, shareCount,
//                    searchTagCount, popularScore }
// categories       { name, slug, videoCount, icon? }
//                    -- `icon` opsional: id ikon manual dari js/icons.js,
//                    diisi lewat panel admin (tab Pengaturan). Kalau tidak
//                    ada, ikon ditebak otomatis (lihat resolveCategoryIcon
//                    di js/icons.js).
// tags             { name, slug, searchCount, videoCount }
// comments         { videoId, uid, userName, userPhoto, text, parentId,
//                    likeCount, dislikeCount, createdAt }
// views            { videoId, uid, viewedAt }  // 1 uid = 1 view / 24 jam
// likes            { videoId, uid }
// shares           { videoId, uid, platform, sharedAt }
// favorites        { uid, videoId, addedAt }
// history          { uid, videoId, lastPosition, watchedAt }
// search_logs      { term, uid, searchedAt }
// reports          { videoId, uid, reason, createdAt }
// settings         { siteName, logoUrl, favicon, themeColor, footerText,
//                    socialLinks, contactEmail, gaId, gscVerification }
// notifications    { uid, title, message, read, createdAt }
// ============================================================
