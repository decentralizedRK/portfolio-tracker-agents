/**
 * Firebase Cloud Functions — Razorpay Payment Integration
 *
 * Environment variables (set via Firebase CLI):
 *   firebase functions:config:set razorpay.key_id="rzp_live_XXX" razorpay.key_secret="XXX"
 *
 * Or for Firebase Functions v2 (recommended), set in .env.local / Secret Manager:
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
 *
 * Deploy: firebase deploy --only functions
 */

const functions  = require('firebase-functions');
const admin      = require('firebase-admin');
const Razorpay   = require('razorpay');
const crypto     = require('crypto');

admin.initializeApp();
const db = admin.firestore();

// ── Razorpay client — lazy init so module loads cleanly during deploy analysis ─
let _razorpay = null;
function getRazorpay() {
  if (!_razorpay) {
    _razorpay = new Razorpay({
      key_id:     process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _razorpay;
}

// ── Pricing config ────────────────────────────────────────────────────────────
const PLANS = {
  monthly:  { amount: 19900,  currency: 'INR', period: 30,   label: 'Monthly' },   // ₹199
  yearly:   { amount: 149900, currency: 'INR', period: 365,  label: 'Yearly' },    // ₹1,499
  lifetime: { amount: 499900, currency: 'INR', period: 36500, label: 'Lifetime' }, // ₹4,999
};

// ── Helper: verify Firebase ID token and return uid ───────────────────────────
async function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) throw new Error('Missing auth token');
  const decoded = await admin.auth().verifyIdToken(auth.split('Bearer ')[1]);
  return decoded.uid;
}

// ── Helper: CORS headers ──────────────────────────────────────────────────────
function setCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

// ── 1. createOrder ────────────────────────────────────────────────────────────
// POST /createOrder  { plan: 'monthly' | 'yearly' | 'lifetime' }
// Returns { order_id, amount, currency, key_id }
exports.createOrder = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const uid  = await verifyToken(req);
    const plan = PLANS[req.body?.plan];
    if (!plan) { res.status(400).json({ error: 'Invalid plan' }); return; }

    const rz    = getRazorpay();
    const order = await rz.orders.create({
      amount:   plan.amount,
      currency: plan.currency,
      receipt:  `rcpt_${uid.slice(0, 10)}_${Date.now()}`,
      notes:    { uid, plan: req.body.plan },
    });

    res.json({
      order_id: order.id,
      amount:   plan.amount,
      currency: plan.currency,
      key_id:   rz.key_id,
    });
  } catch (e) {
    console.error('createOrder error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── 2. verifyPayment ──────────────────────────────────────────────────────────
// POST /verifyPayment  { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan }
// Verifies signature, writes subscription to Firestore
exports.verifyPayment = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const uid = await verifyToken(req);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan: planKey } = req.body;

    // Signature verification
    const expected = crypto
      .createHmac('sha256', getRazorpay().key_secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      res.status(400).json({ error: 'Invalid payment signature' });
      return;
    }

    const plan   = PLANS[planKey] ?? PLANS.monthly;
    const now    = admin.firestore.Timestamp.now();
    const endMs  = Date.now() + plan.period * 24 * 60 * 60 * 1000;

    await db.collection('users').doc(uid).set({
      subscription: {
        plan:               planKey,
        status:             'active',
        razorpay_payment_id,
        razorpay_order_id,
        current_period_end: admin.firestore.Timestamp.fromMillis(endMs),
        created_at:         now,
        updatedAt:          now,
      },
    }, { merge: true });

    res.json({ success: true });
  } catch (e) {
    console.error('verifyPayment error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── 3. razorpayWebhook ────────────────────────────────────────────────────────
// POST /razorpayWebhook  — called by Razorpay for subscription events
// Set webhook secret in Razorpay Dashboard → Settings → Webhooks
exports.razorpayWebhook = functions.https.onRequest(async (req, res) => {
  const webhookSecret = functions.config().razorpay?.webhook_secret || process.env.RAZORPAY_WEBHOOK_SECRET;
  const sig = req.headers['x-razorpay-signature'];
  const body = JSON.stringify(req.body);

  if (webhookSecret && sig) {
    const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
    if (expected !== sig) { res.status(400).send('Invalid signature'); return; }
  }

  const { event, payload } = req.body;
  const payment = payload?.payment?.entity ?? payload?.subscription?.entity;
  const uid     = payment?.notes?.uid;

  if (!uid) { res.status(200).send('ok'); return; }

  try {
    if (event === 'payment.captured') {
      // Already handled by verifyPayment; no-op here unless using Razorpay Subscriptions
    } else if (event === 'subscription.charged') {
      const planKey = payment.notes?.plan ?? 'monthly';
      const plan    = PLANS[planKey] ?? PLANS.monthly;
      const endMs   = Date.now() + plan.period * 24 * 60 * 60 * 1000;
      await db.collection('users').doc(uid).set({
        subscription: {
          status:             'active',
          current_period_end: admin.firestore.Timestamp.fromMillis(endMs),
          updatedAt:          admin.firestore.Timestamp.now(),
        },
      }, { merge: true });
    } else if (event === 'subscription.cancelled' || event === 'payment.failed') {
      await db.collection('users').doc(uid).set({
        subscription: { status: 'cancelled', updatedAt: admin.firestore.Timestamp.now() },
      }, { merge: true });
    }
  } catch (e) {
    console.error('webhook error:', e);
  }

  res.status(200).send('ok');
});
