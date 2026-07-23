import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged,
  signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, sendEmailVerification, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc,
  deleteDoc, query, where, orderBy, limit, startAfter, onSnapshot,
  increment, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAE8trK37zYX9wK2kySOHOekB4iDiJHABc",
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
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, startAfter, onSnapshot,
  increment, serverTimestamp, Timestamp
};
