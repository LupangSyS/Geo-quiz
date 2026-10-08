import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously, GoogleAuthProvider, signInWithPopup, linkWithPopup, signInWithCredential, signOut }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { initializeFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, runTransaction, serverTimestamp, query, orderBy, limit }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

export const configured = !!firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('YOUR_');
let app = null, auth = null, db = null;
if (configured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
}
export const F = { db, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, runTransaction, serverTimestamp, query, orderBy, limit };
export const A = { auth, onAuthStateChanged, signInAnonymously, GoogleAuthProvider, signInWithPopup, linkWithPopup, signInWithCredential, signOut };
