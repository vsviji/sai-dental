/* ═══════════════════════════════════════════
   SAI DENTAL CLINIC — FIREBASE INIT
   firebase-init.js  (loaded as type="module")
═══════════════════════════════════════════ */

import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithEmailAndPassword,
         onAuthStateChanged, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, doc, setDoc,
         getDocs, deleteDoc, query, orderBy,
         enableIndexedDbPersistence, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            "AIzaSyDmUdxMkrMKgIn0v6p5Hr8dbVtXeJ_KPpw",
  authDomain:        "saidentalclinic-4e0de.firebaseapp.com",
  projectId:         "saidentalclinic-4e0de",
  storageBucket:     "saidentalclinic-4e0de.firebasestorage.app",
  messagingSenderId: "398016540592",
  appId:             "1:398016540592:web:a31f0eb0a231d20460f075",
  measurementId:     "G-V9ZL1YTWVB"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

enableIndexedDbPersistence(db).catch(err => {
  if (err.code === 'failed-precondition') {
    console.warn('Multiple tabs open — offline persistence active in first tab only.');
  } else if (err.code === 'unimplemented') {
    console.warn('Browser does not support offline persistence.');
  }
});

/* Expose to global scope so app.js (classic script) can access */
window._auth = auth;
window._db   = db;
window._fb   = {
  signInWithEmailAndPassword, onAuthStateChanged, signOut,
  collection, doc, setDoc, getDocs, deleteDoc,
  query, orderBy, serverTimestamp
};
