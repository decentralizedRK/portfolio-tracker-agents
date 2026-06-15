// Firebase configuration + initialization
// Firebase client-side API keys are safe to commit — they are public identifiers.
// Security is enforced by Firestore Security Rules and Firebase Authentication.

const FIREBASE_CONFIGURED = true;

const firebaseConfig = {
  apiKey: "AIzaSyDNjG_H2aqwbAv7-WRAFRsuimgwfpYX76Q",
  authDomain: "portfolio-tracer.firebaseapp.com",
  projectId: "portfolio-tracer",
  storageBucket: "portfolio-tracer.firebasestorage.app",
  messagingSenderId: "776567420733",
  appId: "1:776567420733:web:81acdd7b58fb365106b754",
  measurementId: "G-19VQJP1B77"
};

let auth = null, db = null;

if (typeof FIREBASE_CONFIGURED !== 'undefined' && FIREBASE_CONFIGURED) {
  try {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db   = firebase.firestore();
  } catch (e) {
    console.error('Firebase init failed:', e);
  }
} else {
  console.info(
    'Firebase not configured — running in public-only mode.\n' +
    'Edit docs/js/firebase.js and set FIREBASE_CONFIGURED = true to enable login.'
  );
}
