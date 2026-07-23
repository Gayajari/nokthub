// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAE8trK37zYX9wK2kyS0HOekB4iDiJHABc",
  authDomain: "nokt-hub.firebaseapp.com",
  projectId: "nokt-hub",
  storageBucket: "nokt-hub.firebasestorage.app",
  messagingSenderId: "513126228477",
  appId: "1:513126228477:web:7464f06839e7f7ea8f3994",
  measurementId: "G-43WH4M83ZC"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
