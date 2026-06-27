// ── FIRESTORE CRUD ────────────────────────────────────────────────────────────

function _userRef(uid) {
  return db.collection('users').doc(uid);
}

// ── Holdings ──────────────────────────────────────────────────────────────────

async function saveHolding(uid, holding) {
  const ticker  = holding.ticker.toUpperCase();
  const display = ticker.replace(/\.(NS|BO)$/, '');
  const currency = holding.currency ||
    (ticker.endsWith('.NS') || ticker.endsWith('.BO') ? 'INR' : 'USD');
  await _userRef(uid).collection('holdings').doc(ticker).set({
    ticker,
    display,
    qty:           Number(holding.qty),
    avg_buy_price: Number(holding.avg_buy_price),
    currency,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    addedAt:   firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function deleteHolding(uid, ticker) {
  await _userRef(uid).collection('holdings').doc(ticker.toUpperCase()).delete();
}

async function getHoldings(uid) {
  const snap = await _userRef(uid).collection('holdings').get();
  return snap.docs.map(d => d.data());
}

async function bulkImportHoldings(uid, holdingsArray) {
  const batch = db.batch();
  for (const h of holdingsArray) {
    const ticker   = h.ticker.toUpperCase();
    const display  = ticker.replace(/\.(NS|BO)$/, '');
    const currency = h.currency ||
      (ticker.endsWith('.NS') || ticker.endsWith('.BO') ? 'INR' : 'USD');
    const ref = _userRef(uid).collection('holdings').doc(ticker);
    batch.set(ref, {
      ticker, display,
      qty:           Number(h.qty),
      avg_buy_price: Number(h.avg_buy_price),
      currency,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      addedAt:   firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
}

// ── Mutual Funds ──────────────────────────────────────────────────────────────

async function saveMutualFund(uid, fund) {
  const code = String(fund.scheme_code);
  await _userRef(uid).collection('mutual_funds').doc(code).set({
    name:        fund.name,
    scheme_code: code,
    units:       Number(fund.units),
    avg_nav:     Number(fund.avg_nav),
    sip_amount:  Number(fund.sip_amount || 0),
    sip_date:    Number(fund.sip_date   || 1),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    addedAt:   firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function deleteMutualFund(uid, schemeCode) {
  await _userRef(uid).collection('mutual_funds').doc(String(schemeCode)).delete();
}

async function getMutualFunds(uid) {
  const snap = await _userRef(uid).collection('mutual_funds').get();
  return snap.docs.map(d => d.data());
}

async function bulkImportMutualFunds(uid, fundsArray) {
  const batch = db.batch();
  for (const f of fundsArray) {
    const code = String(f.scheme_code);
    const ref  = _userRef(uid).collection('mutual_funds').doc(code);
    batch.set(ref, {
      name:        f.name,
      scheme_code: code,
      units:       Number(f.units),
      avg_nav:     Number(f.avg_nav),
      sip_amount:  Number(f.sip_amount || 0),
      sip_date:    Number(f.sip_date   || 1),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      addedAt:   firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

async function saveSnapshot(uid, dateStr, snapshot) {
  await _userRef(uid).collection('snapshots').doc(dateStr).set(snapshot, { merge: true });
}

async function getSnapshots(uid, startDate, endDate) {
  const snap = await _userRef(uid).collection('snapshots')
    .where(firebase.firestore.FieldPath.documentId(), '>=', startDate)
    .where(firebase.firestore.FieldPath.documentId(), '<=', endDate)
    .orderBy(firebase.firestore.FieldPath.documentId())
    .get();
  return snap.docs.map(d => ({ date: d.id, ...d.data() }));
}

// ── Subscription ──────────────────────────────────────────────────────────────

async function getSubscription(uid) {
  const doc = await _userRef(uid).get();
  return doc.exists ? (doc.data().subscription ?? null) : null;
}

async function updateSubscription(uid, data) {
  await _userRef(uid).set({
    subscription: { ...data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
  }, { merge: true });
}
