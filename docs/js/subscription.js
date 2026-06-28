// ── SUBSCRIPTION & PAYWALL ────────────────────────────────────────────────────
//
// Config — fill these in after deploying Cloud Functions + Razorpay setup:
//   FUNCTIONS_BASE : Cloud Functions base URL
//                    e.g. https://us-central1-portfolio-tracer.cloudfunctions.net
//   RAZORPAY_KEY_ID: Your Razorpay Key ID (starts with rzp_live_ or rzp_test_)
//
const FUNCTIONS_BASE  = 'https://us-central1-portfolio-tracer.cloudfunctions.net';
const RAZORPAY_KEY_ID = 'rzp_test_T6l277hK4u5E9S';

const PLANS = {
  monthly:  { label: 'Monthly',  price: '₹199',  sub: '₹199 / month',     tag: '' },
  yearly:   { label: 'Yearly',   price: '₹1,499', sub: '₹125 / month',    tag: 'Save 37%' },
  lifetime: { label: 'Lifetime', price: '₹4,999', sub: 'One-time payment', tag: 'Best Value' },
};

// ── State ─────────────────────────────────────────────────────────────────────
let _subscription = null;   // raw Firestore subscription object

// ── Subscription check ────────────────────────────────────────────────────────

function isSubscriptionActive(sub) {
  if (!sub || sub.status !== 'active') return false;
  if (!sub.current_period_end) return false;
  // Firestore Timestamp → Date
  const end = sub.current_period_end.toDate ? sub.current_period_end.toDate() : new Date(sub.current_period_end);
  return end > new Date();
}

async function checkAndApplySubscription(uid) {
  try {
    _subscription = await getSubscription(uid);
  } catch (_) {
    _subscription = null;
  }
  const active = isSubscriptionActive(_subscription);
  if (active) {
    _showDashboard();
  } else {
    _showPaywall();
  }
  _updateSubBadge();
  return active;
}

// ── UI: show / hide dashboard vs paywall ──────────────────────────────────────

function _showDashboard() {
  document.getElementById('landing-page')?.classList.add('hidden');
  document.getElementById('paywall-overlay')?.classList.add('hidden');
  document.getElementById('app-main')?.classList.remove('hidden');
}

function _showPaywall() {
  document.getElementById('landing-page')?.classList.remove('hidden');
  document.getElementById('app-main')?.classList.add('hidden');
  document.getElementById('paywall-overlay')?.classList.add('hidden');

  const user = typeof firebase !== 'undefined' ? firebase.auth().currentUser : null;
  const guestNote = document.getElementById('signin-note-guest');
  const userNote  = document.getElementById('signin-note-user');
  const emailSpan = document.getElementById('signin-note-email');
  if (user) {
    guestNote?.classList.add('hidden');
    if (emailSpan) emailSpan.textContent = user.email;
    userNote?.classList.remove('hidden');
  } else {
    guestNote?.classList.remove('hidden');
    userNote?.classList.add('hidden');
  }
}

function _showLanding() {
  document.getElementById('landing-page')?.classList.remove('hidden');
  document.getElementById('app-main')?.classList.add('hidden');
}

function _updateSubBadge() {
  const badge = document.getElementById('sub-badge');
  if (!badge) return;
  if (isSubscriptionActive(_subscription)) {
    const plan = _subscription?.plan ?? 'pro';
    badge.textContent = plan === 'lifetime' ? 'LIFETIME' : 'PRO';
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ── Razorpay Checkout ─────────────────────────────────────────────────────────

async function subscribe(planKey) {
  const user = typeof firebase !== 'undefined' ? firebase.auth().currentUser : null;
  if (!user) { if (typeof showAuthModal === 'function') showAuthModal('signup'); return; }

  if (!FUNCTIONS_BASE || !RAZORPAY_KEY_ID) {
    alert('Payment not configured yet. Contact the administrator.');
    return;
  }

  const btn = document.getElementById(`subscribe-btn-${planKey}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }

  try {
    const idToken = await user.getIdToken();

    // Step 1: create order via Cloud Function
    const orderResp = await fetch(`${FUNCTIONS_BASE}/createOrder`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ plan: planKey }),
    });
    if (!orderResp.ok) throw new Error('Order creation failed');
    const { order_id, amount, currency } = await orderResp.json();

    // Step 2: open Razorpay Checkout
    const rzp = new Razorpay({
      key:         RAZORPAY_KEY_ID,
      amount,
      currency,
      name:        'Portfolio Tracker Pro',
      description: PLANS[planKey]?.label + ' Subscription',
      order_id,
      prefill:     { email: user.email, name: user.displayName ?? '' },
      theme:       { color: '#6366f1' },
      handler: async function (response) {
        // Step 3: verify payment via Cloud Function
        const verifyResp = await fetch(`${FUNCTIONS_BASE}/verifyPayment`, {
          method:  'POST',
          headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ...response, plan: planKey }),
        });
        if (verifyResp.ok) {
          if (typeof showToast === 'function') showToast('Payment successful! Welcome to Pro.', 'success');
          await checkAndApplySubscription(user.uid);
        } else {
          if (typeof showToast === 'function') showToast('Payment verification failed — contact support.', 'error');
        }
      },
      modal: {
        ondismiss: () => {
          if (btn) { btn.disabled = false; btn.textContent = 'Subscribe'; }
        },
      },
    });
    rzp.open();
  } catch (e) {
    console.error('subscribe error:', e);
    if (typeof showToast === 'function') showToast('Payment error: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Subscribe'; }
  }
}
