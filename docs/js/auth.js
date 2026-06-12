// ── AUTHENTICATION ────────────────────────────────────────────────────────────
let _currentUser = null;

function isFirebaseReady() { return auth !== null && db !== null; }

async function signInWithGoogle() {
  if (!isFirebaseReady()) return;
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  } catch (e) {
    showAuthError(e.message);
  }
}

async function signInWithEmail(email, password) {
  if (!isFirebaseReady()) return;
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (e) {
    showAuthError(e.message);
  }
}

async function signUpWithEmail(email, password) {
  if (!isFirebaseReady()) return;
  try {
    await auth.createUserWithEmailAndPassword(email, password);
  } catch (e) {
    showAuthError(e.message);
  }
}

async function doSignOut() {
  if (!isFirebaseReady()) return;
  try {
    await auth.signOut();
  } catch (e) {
    console.error('Sign out error:', e);
  }
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showAuthModal(mode) {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  setAuthMode(mode || 'signin');
}

function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.add('hidden');
}

function setAuthMode(mode) {
  const err = document.getElementById('auth-error');
  if (err) { err.textContent = ''; err.classList.add('hidden'); }
  const modeEl    = document.getElementById('auth-mode');
  const signupBtn = document.getElementById('auth-signup-btn');
  const signinBtn = document.getElementById('auth-signin-btn');
  const toggleLnk = document.getElementById('auth-toggle-link');
  const toggleTxt = document.getElementById('auth-toggle-text');
  if (modeEl)    modeEl.value           = mode;
  if (signupBtn) signupBtn.classList.toggle('hidden', mode !== 'signup');
  if (signinBtn) signinBtn.classList.toggle('hidden', mode !== 'signin');
  if (toggleLnk) toggleLnk.textContent  = mode === 'signin' ? 'Create account' : 'Sign in instead';
  if (toggleTxt) toggleTxt.textContent  = mode === 'signin' ? "Don't have an account?" : 'Already have an account?';
}

function toggleAuthMode() {
  const mode = document.getElementById('auth-mode')?.value;
  setAuthMode(mode === 'signin' ? 'signup' : 'signin');
  return false;
}

function handleAuthFormSubmit() {
  const mode     = document.getElementById('auth-mode')?.value;
  const email    = document.getElementById('auth-email')?.value?.trim();
  const password = document.getElementById('auth-password')?.value;
  if (!email || !password) { showAuthError('Email and password are required.'); return; }
  if (mode === 'signup') signUpWithEmail(email, password);
  else signInWithEmail(email, password);
}

function updateAuthUI(user) {
  _currentUser = user;
  const signInBtn  = document.getElementById('header-signin-btn');
  const userInfo   = document.getElementById('header-user-info');
  const userName   = document.getElementById('header-user-name');
  const userAvatar = document.getElementById('header-user-avatar');
  const addTabNote = document.getElementById('add-tab-auth-note');

  if (user) {
    if (signInBtn)  signInBtn.classList.add('hidden');
    if (userInfo)   userInfo.classList.remove('hidden');
    if (userName)   userName.textContent = user.displayName || user.email?.split('@')[0] || 'User';
    if (userAvatar) {
      if (user.photoURL) {
        userAvatar.src = user.photoURL;
        userAvatar.classList.remove('hidden');
      } else {
        userAvatar.classList.add('hidden');
      }
    }
    if (addTabNote) addTabNote.classList.add('hidden');
    hideAuthModal();
  } else {
    if (signInBtn)  signInBtn.classList.remove('hidden');
    if (userInfo)   userInfo.classList.add('hidden');
    if (addTabNote) addTabNote.classList.remove('hidden');
  }
}
