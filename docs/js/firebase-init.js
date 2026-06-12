// Firebase app initialization — runs after firebase-config.js
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
    'Edit docs/js/firebase-config.js and set FIREBASE_CONFIGURED = true to enable login.'
  );
}
