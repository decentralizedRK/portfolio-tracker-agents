// ── SECURITY HELPERS ────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function safeHref(url) {
  try { const u = new URL(url); return (u.protocol === 'https:' || u.protocol === 'http:') ? url : '#'; }
  catch (_) { return '#'; }
}

// ── DATA PATHS ──────────────────────────────────────────────────────────────
const BASE  = './data';
const PATHS = {
  snapshot:        `${BASE}/portfolio_snapshot.json`,
  news:            `${BASE}/news_digest.json`,
  recommendations: `${BASE}/recommendations.json`,
  corporate:       `${BASE}/corporate_actions.json`,
  mf:              `${BASE}/mf_snapshot.json`,
};

// ── STATE ───────────────────────────────────────────────────────────────────
let _holdings   = [];
let _sortKey    = 'invested';
let _sortAsc    = false;
let _filter     = '';
let _pnlChart        = null;
let _allocationChart = null;
let _stockTotals = { invested: 0, current: 0, count: 0 };
let _mfTotals    = { invested: 0, current: 0, count: 0 };
let _mfFunds     = [];   // full fund list from snapshot, kept for SIP total + JSON generation
// MF table state
let _mfSortKey = 'invested';
let _mfSortAsc = false;
let _mfFilter  = '';
// Edit modal state
let _editTicker     = null;
let _editSchemeCode = null;

// ── UTILS ───────────────────────────────────────────────────────────────────
const fmt = {
  inr:  v => v != null ? '₹' + Number(v).toLocaleString('en-IN', {maximumFractionDigits:0}) : '—',
  inr2: v => v != null ? '₹' + Number(v).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2}) : '—',
  pct:  v => v != null ? (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%' : '—',
  ts:   s => { if(!s) return '—'; const d = new Date(s); return d.toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})+' IST'; },
  date: s => { if(!s) return '—'; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); },
};

function tvUrl(ticker) {
  if (!ticker) return '#';
  if (ticker.endsWith('.NS')) return `https://www.tradingview.com/chart/?symbol=NSE:${ticker.replace('.NS','')}`;
  if (ticker.endsWith('.BO')) return `https://www.tradingview.com/chart/?symbol=BSE:${ticker.replace('.BO','')}`;
  return `https://www.tradingview.com/chart/?symbol=${ticker}`;
}

async function loadJSON(path) {
  const r = await fetch(path + '?t=' + Date.now());
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// ── MARKET STATUS ───────────────────────────────────────────────────────────
function checkMarketStatus() {
  const ist  = new Date(new Date().toLocaleString('en-US', {timeZone:'Asia/Kolkata'}));
  const day  = ist.getDay();
  const mins = ist.getHours() * 60 + ist.getMinutes();
  const el   = document.getElementById('market-status');
  if (day === 0 || day === 6) {
    el.textContent = 'NSE Closed (Weekend)'; el.style.color = '#94a3b8';
  } else if (mins >= 555 && mins <= 930) {
    el.textContent = 'NSE Open'; el.style.color = '#34d399';
  } else {
    el.textContent = 'NSE Closed'; el.style.color = '#94a3b8';
  }
}

// ── COMBINED STAT CARDS ──────────────────────────────────────────────────────
function updateCombinedStats() {
  const invested = _stockTotals.invested + _mfTotals.invested;
  const current  = _stockTotals.current  + _mfTotals.current;
  const pnl      = current - invested;
  const pct      = invested > 0 ? (pnl / invested * 100) : 0;

  document.getElementById('s-stocks').textContent =
    `${_stockTotals.count} stocks · ${_mfTotals.count} funds`;

  const pnlColor = pct > 0 ? '#34d399' : pct < 0 ? '#f87171' : '#e2e8f0';
  ['s-current', 's-pnl', 's-pct'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.color = pnlColor;
  });
  ['s-current-sub', 's-pnl-sub'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = fmt.pct(pct); el.style.color = pnlColor; }
  });

  countUp('s-invested', invested, v => fmt.inr(Math.max(0, v)));
  countUp('s-current',  current,  v => fmt.inr(Math.max(0, v)));
  countUp('s-pnl', pnl, v => (v >= 0 ? '+' : '') + fmt.inr(Math.abs(v)));
  countUp('s-pct', pct, v => fmt.pct(v));
}

// ── PRICE MAP HELPERS ────────────────────────────────────────────────────────
let _priceMap = {};   // ticker -> current_price, populated from public snapshot
let _navMap   = {};   // scheme_code -> current_nav, populated from MF snapshot
let _authResolved = !isFirebaseReady(); // true immediately if Firebase not configured

function computePortfolioView(holdings, priceMap) {
  return holdings.map(h => {
    const price   = priceMap[h.ticker] ?? 0;
    const invested = h.qty * h.avg_buy_price;
    const current  = h.qty * price;
    const pnl      = current - invested;
    const pnl_pct  = h.avg_buy_price > 0 ? (price - h.avg_buy_price) / h.avg_buy_price * 100 : 0;
    return { ...h, current_price: price, invested, current_value: current, pnl, pnl_pct };
  });
}

function computeMFView(funds, navMap) {
  return funds.map(f => {
    const nav      = navMap[String(f.scheme_code)] ?? f.avg_nav ?? 0;
    const invested = f.units * f.avg_nav;
    const current  = f.units * nav;
    const pnl      = current - invested;
    const pnl_pct  = f.avg_nav > 0 ? (nav - f.avg_nav) / f.avg_nav * 100 : 0;
    return { ...f, current_nav: nav, invested, current_value: current, pnl, pnl_pct };
  });
}

// ── SNAPSHOT ────────────────────────────────────────────────────────────────
async function loadSnapshot() {
  const d = await loadJSON(PATHS.snapshot);

  document.getElementById('last-updated').textContent =
    d.timestamp ? 'Updated ' + fmt.ts(d.timestamp) : 'Not yet fetched';

  // Build price map from snapshot for use by user portfolio view
  _priceMap = {};
  (d.holdings ?? []).forEach(h => { _priceMap[h.ticker] = h.current_price; });

  if (_currentUser) {
    // Logged-in: re-render holdings table with Firestore data + fresh prices
    const firestoreView = computePortfolioView(_userHoldings, _priceMap);
    _stockTotals = {
      invested: firestoreView.reduce((s, h) => s + h.invested, 0),
      current:  firestoreView.reduce((s, h) => s + h.current_value, 0),
      count:    firestoreView.length,
    };
    _holdings = firestoreView;
    renderTable();
    renderChart(firestoreView);
    renderAllocationChart(firestoreView);
    const sorted = [...firestoreView].sort((a, b) => (b.pnl_pct ?? 0) - (a.pnl_pct ?? 0));
    renderLeaderboard('runners-list',  sorted.slice(0, 5),  true);
    renderLeaderboard('draggers-list', sorted.slice(-5).reverse(), false);
  } else if (_authResolved) {
    // Auth resolved as logged-out — show public snapshot
    _stockTotals = {
      invested: d.total_invested ?? 0,
      current:  d.total_current  ?? 0,
      count:    d.holdings?.length ?? 0,
    };
    _holdings = d.holdings ?? [];
    renderTable();
    renderChart(d.holdings ?? []);
    renderAllocationChart(d.holdings ?? []);
    renderLeaderboard('runners-list',  d.runners  ?? [], true);
    renderLeaderboard('draggers-list', d.draggers ?? [], false);
  } else {
    // Auth still pending — show loading state, skip public render
    const tbody = document.getElementById('holdings-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="text-center text-slate-500 py-8 text-sm">Loading your portfolio…</td></tr>';
    return;
  }
  updateCombinedStats();
}

// ── USER PORTFOLIO (FIRESTORE) ───────────────────────────────────────────────
let _userHoldings = [];
let _userMFFunds  = [];

async function loadUserPortfolio(uid) {
  try {
    [_userHoldings, _userMFFunds] = await Promise.all([
      getHoldings(uid),
      getMutualFunds(uid),
    ]);
  } catch (e) {
    console.error('Firestore portfolio load failed:', e);
    _userHoldings = [];
    _userMFFunds  = [];
  }

  // Re-render holdings with Firestore data + current prices
  const view = computePortfolioView(_userHoldings, _priceMap);
  _holdings = view;
  _stockTotals = {
    invested: view.reduce((s, h) => s + h.invested, 0),
    current:  view.reduce((s, h) => s + h.current_value, 0),
    count:    view.length,
  };

  // Re-render MF table with Firestore funds + current NAVs
  const mfView = computeMFView(_userMFFunds, _navMap);
  _mfFunds = mfView;
  _mfTotals = {
    invested: mfView.reduce((s, f) => s + f.invested, 0),
    current:  mfView.reduce((s, f) => s + f.current_value, 0),
    count:    mfView.length,
  };

  updateCombinedStats();
  renderTable();
  renderMFTable(mfView);
  renderChart(view);
  renderAllocationChart(view);

  const sorted = [...view].sort((a, b) => (b.pnl_pct ?? 0) - (a.pnl_pct ?? 0));
  renderLeaderboard('runners-list',  sorted.slice(0, 5),         true);
  renderLeaderboard('draggers-list', sorted.slice(-5).reverse(), false);

  // Create today's snapshot in Firestore (non-blocking)
  maybeCreateDailySnapshot(uid, _userHoldings, _userMFFunds, _priceMap, _navMap);

  // Show performance auth-note state
  const perfAuthNote    = document.getElementById('perf-auth-note');
  const perfContent     = document.getElementById('perf-content');
  if (perfAuthNote) perfAuthNote.classList.add('hidden');
  if (perfContent)  perfContent.classList.remove('hidden');
}

function triggerRecalculate() {
  if (!_currentUser) return;
  recalculateTodaySnapshot(_currentUser.uid, _userHoldings, _userMFFunds, _priceMap, _navMap);
}

async function onUserSignedOut() {
  _userHoldings = [];
  _userMFFunds  = [];
  // Restore public snapshot view
  try {
    await Promise.all([loadSnapshot(), loadMFTotalsOnly()]);
  } catch (_) {}
  // Revert performance tab
  const perfAuthNote = document.getElementById('perf-auth-note');
  const perfContent  = document.getElementById('perf-content');
  if (perfAuthNote) perfAuthNote.classList.remove('hidden');
  if (perfContent)  perfContent.classList.add('hidden');
}

function setWithColor(valId, val, colorVal, subId, subVal) {
  const el = document.getElementById(valId);
  el.textContent  = val;
  el.style.cssText = colorVal > 0 ? 'color:#34d399' : colorVal < 0 ? 'color:#f87171' : 'color:#e2e8f0';
  if (subId && subVal !== undefined) {
    const sub = document.getElementById(subId);
    if (sub) { sub.textContent = subVal; sub.style.cssText = el.style.cssText; }
  }
}

// ── TOAST NOTIFICATIONS ──────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `toast toast-${type}`;
  div.textContent = message;
  container.appendChild(div);
  setTimeout(() => {
    div.style.transition = 'opacity 0.3s';
    div.style.opacity = '0';
    setTimeout(() => div.remove(), 300);
  }, duration);
}

function showConfirm(message, onConfirm) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'toast toast-warn';
  div.style.maxWidth = '320px';
  div.innerHTML = `<div style="margin-bottom:8px">${escHtml(message)}</div>
    <div style="display:flex;gap:8px">
      <button onclick="this.closest('.toast').remove()" style="flex:1;padding:4px 10px;border-radius:6px;font-size:0.75rem;background:#334155;color:#94a3b8;border:none;cursor:pointer">Cancel</button>
      <button id="_confirm-yes" style="flex:1;padding:4px 10px;border-radius:6px;font-size:0.75rem;background:#ef4444;color:white;border:none;cursor:pointer">Confirm</button>
    </div>`;
  container.appendChild(div);
  div.querySelector('#_confirm-yes').onclick = () => { div.remove(); onConfirm(); };
}

// ── COUNT-UP ANIMATION ────────────────────────────────────────────────────────
function countUp(elementId, target, formatter, duration = 700) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    el.textContent = formatter(target * eased);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = formatter(target);
  };
  requestAnimationFrame(tick);
}

// ── EDIT HOLDING MODAL ────────────────────────────────────────────────────────
function showEditModal(ticker) {
  const h = _holdings.find(x => x.ticker === ticker);
  if (!h) return;
  _editTicker = ticker;
  document.getElementById('edit-holding-name').textContent = h.display || ticker;
  document.getElementById('edit-holding-qty').value   = h.qty ?? '';
  document.getElementById('edit-holding-price').value = h.avg_buy_price ?? '';
  document.getElementById('edit-holding-currency-sym').textContent = h.currency === 'USD' ? '$' : '₹';
  document.getElementById('edit-holding-cmp').textContent = h.currency === 'USD'
    ? '$' + Number(h.current_price).toFixed(2)
    : '₹' + Number(h.current_price).toLocaleString('en-IN');
  const pnl = h.pnl ?? 0;
  const pnlEl = document.getElementById('edit-holding-pnl');
  pnlEl.textContent = (pnl >= 0 ? '+' : '') + fmt.inr(pnl) + ' (' + fmt.pct(h.pnl_pct) + ')';
  pnlEl.style.color = pnl > 0 ? '#34d399' : pnl < 0 ? '#f87171' : '#94a3b8';
  document.getElementById('edit-holding-error').classList.add('hidden');
  document.getElementById('edit-holding-modal').classList.remove('hidden');
}

function hideEditModal() {
  document.getElementById('edit-holding-modal').classList.add('hidden');
  _editTicker = null;
}

async function saveEditedHolding() {
  if (!_currentUser || !_editTicker) return;
  const qty   = parseFloat(document.getElementById('edit-holding-qty').value);
  const price = parseFloat(document.getElementById('edit-holding-price').value);
  const errEl = document.getElementById('edit-holding-error');
  if (!qty || qty <= 0 || !price || price <= 0) {
    errEl.textContent = 'Please enter valid quantity and price.';
    errEl.classList.remove('hidden');
    return;
  }
  errEl.classList.add('hidden');
  try {
    const h = _holdings.find(x => x.ticker === _editTicker);
    await saveHolding(_currentUser.uid, {
      ticker:        _editTicker,
      qty,
      avg_buy_price: price,
      currency:      h?.currency,
    });
    hideEditModal();
    showToast(`${_editTicker} updated successfully`, 'success');
    await loadUserPortfolio(_currentUser.uid);
  } catch (e) {
    errEl.textContent = 'Save failed: ' + e.message;
    errEl.classList.remove('hidden');
  }
}

// ── EDIT MF MODAL ─────────────────────────────────────────────────────────────
function showEditMFModal(schemeCode) {
  const f = _mfFunds.find(x => String(x.scheme_code) === String(schemeCode));
  if (!f) return;
  _editSchemeCode = String(schemeCode);
  document.getElementById('edit-mf-name-label').textContent = f.name ?? schemeCode;
  document.getElementById('edit-mf-units').value = f.units ?? '';
  document.getElementById('edit-mf-nav').value   = f.avg_nav ?? '';
  document.getElementById('edit-mf-error').classList.add('hidden');
  document.getElementById('edit-mf-modal').classList.remove('hidden');
}

function hideEditMFModal() {
  document.getElementById('edit-mf-modal').classList.add('hidden');
  _editSchemeCode = null;
}

async function saveEditedMF() {
  if (!_currentUser || !_editSchemeCode) return;
  const units = parseFloat(document.getElementById('edit-mf-units').value);
  const nav   = parseFloat(document.getElementById('edit-mf-nav').value);
  const errEl = document.getElementById('edit-mf-error');
  if (!units || units <= 0 || !nav || nav <= 0) {
    errEl.textContent = 'Please enter valid units and NAV.';
    errEl.classList.remove('hidden');
    return;
  }
  errEl.classList.add('hidden');
  try {
    const f = _mfFunds.find(x => String(x.scheme_code) === _editSchemeCode);
    await saveMutualFund(_currentUser.uid, {
      name:        f?.name ?? '',
      scheme_code: _editSchemeCode,
      units,
      avg_nav:     nav,
      sip_amount:  f?.sip_amount ?? 0,
      sip_date:    f?.sip_date   ?? 1,
    });
    hideEditMFModal();
    showToast('Fund updated successfully', 'success');
    await loadUserPortfolio(_currentUser.uid);
  } catch (e) {
    errEl.textContent = 'Save failed: ' + e.message;
    errEl.classList.remove('hidden');
  }
}

async function removeMutualFund(schemeCode) {
  if (!_currentUser || !db) return;
  const f = _mfFunds.find(x => String(x.scheme_code) === String(schemeCode));
  const name = f?.name?.slice(0, 30) ?? schemeCode;
  showConfirm(`Remove "${name}" from your portfolio?`, async () => {
    try {
      await deleteMutualFund(_currentUser.uid, schemeCode);
      showToast('Fund removed', 'success');
      await loadUserPortfolio(_currentUser.uid);
    } catch (e) {
      showToast('Remove failed: ' + e.message, 'error');
    }
  });
}

// ── MF TABLE SORT + FILTER ────────────────────────────────────────────────────
function sortMFTable(key) {
  if (_mfSortKey === key) _mfSortAsc = !_mfSortAsc;
  else { _mfSortKey = key; _mfSortAsc = false; }
  renderMFTable(_mfFunds);
}

function filterMFTable(val) { _mfFilter = val; renderMFTable(_mfFunds); }

// ── LEADERBOARD ─────────────────────────────────────────────────────────────
function renderLeaderboard(containerId, items, isRunners) {
  const el = document.getElementById(containerId);
  if (!items.length) { el.innerHTML = '<p class="text-xs text-slate-600">No data yet</p>'; return; }
  el.innerHTML = items.map(h => {
    const pct  = h.pnl_pct ?? 0;
    const sign = pct > 0 ? '+' : '';
    const cls  = pct > 0 ? 'tag-up' : 'tag-down';
    const barW = Math.min(Math.abs(pct) * 3, 100);
    const barC = pct > 0 ? '#34d399' : '#f87171';
    return `
      <div class="flex items-center justify-between gap-3">
        <a href="${tvUrl(h.ticker)}" target="_blank" rel="noopener"
           class="ticker-chip text-white flex-shrink-0 hover:text-indigo-300 transition-colors" style="text-decoration:none">${h.display} ↗</a>
        <div class="flex-1 min-w-0">
          <div class="pct-bar-bg"><div class="pct-bar" style="width:${barW}%;background:${barC}"></div></div>
        </div>
        <span class="badge ${cls}">${sign}${pct.toFixed(1)}%</span>
        <span class="text-xs text-slate-400 flex-shrink-0 w-20 text-right">₹${Number(h.current_price).toLocaleString('en-IN',{maximumFractionDigits:1})}</span>
      </div>`;
  }).join('');
}

// ── P&L CHART ───────────────────────────────────────────────────────────────
function renderChart(holdings) {
  const ctx    = document.getElementById('pnl-chart').getContext('2d');
  const sorted = [...holdings].sort((a,b) => (b.pnl_pct??0) - (a.pnl_pct??0));
  const data   = sorted.map(h => +(h.pnl_pct??0).toFixed(2));
  const colors = data.map(v => v >= 0 ? 'rgba(16,185,129,0.75)' : 'rgba(239,68,68,0.75)');
  if (_pnlChart) _pnlChart.destroy();
  _pnlChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: sorted.map(h => h.display), datasets: [{ data, backgroundColor: colors, borderRadius: 4, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => ` ${ctx.raw}%` },
        backgroundColor:'#1e293b', titleColor:'#94a3b8', bodyColor:'#e2e8f0', borderColor:'#334155', borderWidth:1,
      }},
      scales: {
        x: { ticks: { color:'#64748b', font:{size:10} }, grid: { color:'#1e293b' } },
        y: { ticks: { color:'#64748b', font:{size:10}, callback: v => v + '%' }, grid: { color:'#334155' } },
      }
    }
  });
}

// ── ALLOCATION DONUT CHART ───────────────────────────────────────────────────
function renderAllocationChart(holdings) {
  const canvas = document.getElementById('allocation-chart');
  const legendEl = document.getElementById('allocation-legend');
  if (!canvas || !holdings.length) return;

  const COLORS = [
    '#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e',
    '#f97316','#f59e0b','#10b981','#14b8a6','#06b6d4',
    '#3b82f6','#22d3ee','#84cc16','#22c55e','#60a5fa',
  ];

  const total = holdings.reduce((s, h) => s + (h.current_value ?? 0), 0);
  if (!total) return;

  // Sort by current_value descending, group <3% into Others
  const sorted = [...holdings].sort((a, b) => (b.current_value ?? 0) - (a.current_value ?? 0));
  const main = [], otherVal = sorted.reduce((s, h) => {
    const pct = (h.current_value ?? 0) / total * 100;
    if (pct >= 2) { main.push(h); return s; }
    return s + (h.current_value ?? 0);
  }, 0);

  const labels = main.map(h => h.display);
  const data   = main.map(h => h.current_value ?? 0);
  const colors = main.map((_, i) => COLORS[i % COLORS.length]);

  if (otherVal > 0) {
    labels.push('Others');
    data.push(otherVal);
    colors.push('#475569');
  }

  if (_allocationChart) _allocationChart.destroy();
  _allocationChart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor:'#1e293b', titleColor:'#94a3b8', bodyColor:'#e2e8f0', borderColor:'#334155', borderWidth:1,
          callbacks: {
            label: ctx => ` ${(ctx.raw / total * 100).toFixed(1)}%  ${fmt.inr(ctx.raw)}`,
          },
        },
      },
    },
  });

  if (legendEl) {
    legendEl.innerHTML = labels.map((lbl, i) =>
      `<div class="flex items-center gap-2 text-xs">
        <span style="width:8px;height:8px;border-radius:2px;background:${colors[i]};flex-shrink:0;display:inline-block"></span>
        <span class="text-slate-400 truncate" style="max-width:120px" title="${escHtml(lbl)}">${escHtml(lbl)}</span>
        <span class="text-slate-500 ml-auto flex-shrink-0">${(data[i] / total * 100).toFixed(1)}%</span>
      </div>`
    ).join('');
  }
}

// ── STOCKS TABLE ─────────────────────────────────────────────────────────────
function renderTable() {
  const filtered = _holdings.filter(h =>
    !_filter || h.display.toLowerCase().includes(_filter.toLowerCase()) ||
    h.ticker.toLowerCase().includes(_filter.toLowerCase())
  );
  const totalCurrent = filtered.reduce((s, h) => s + (h.current_value ?? 0), 0);
  const sorted = [...filtered].sort((a,b) => {
    if (_sortKey === 'weight') {
      const aw = totalCurrent ? (a.current_value ?? 0) / totalCurrent : 0;
      const bw = totalCurrent ? (b.current_value ?? 0) / totalCurrent : 0;
      return _sortAsc ? aw - bw : bw - aw;
    }
    const av = a[_sortKey] ?? 0, bv = b[_sortKey] ?? 0;
    if (typeof av === 'string') return _sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    return _sortAsc ? av - bv : bv - av;
  });

  const canEdit = !!_currentUser;
  document.getElementById('holdings-body').innerHTML = sorted.map(h => {
    const pct    = h.pnl_pct ?? 0;
    const pnl    = h.pnl    ?? 0;
    const cs     = pct > 0 ? 'color:#34d399' : pct < 0 ? 'color:#f87171' : 'color:#94a3b8';
    const tag    = pct > 0 ? 'tag-up' : pct < 0 ? 'tag-down' : 'tag-neutral';
    const weight = totalCurrent > 0 ? (h.current_value ?? 0) / totalCurrent * 100 : 0;
    const dc     = h.day_change_pct;
    const dcs    = dc != null ? (dc > 0 ? 'color:#34d399' : dc < 0 ? 'color:#f87171' : 'color:#94a3b8') : 'color:#475569';
    const dcStr  = dc != null ? (dc >= 0 ? '+' : '') + dc.toFixed(2) + '%' : '—';
    const editBtn = canEdit
      ? `<button onclick="showEditModal('${escHtml(h.ticker)}')" title="Edit" class="btn-sm btn-edit ml-1" style="padding:2px 6px;font-size:0.7rem">✎</button>`
      : '';
    const delBtn = canEdit
      ? `<button onclick="removeHolding('${escHtml(h.ticker)}')" title="Remove" class="btn-sm btn-danger ml-1" style="padding:2px 6px;font-size:0.7rem">✕</button>`
      : '';
    return `<tr>
      <td><a href="${tvUrl(h.ticker)}" target="_blank" rel="noopener"
             class="ticker-chip hover:text-white transition-colors" style="color:#a5b4fc;text-decoration:none">${h.display} ↗</a>${editBtn}${delBtn}</td>
      <td class="text-right text-slate-300">${h.qty?.toLocaleString('en-IN') ?? '—'}</td>
      <td class="text-right text-slate-400">${fmt.inr2(h.avg_buy_price)}</td>
      <td class="text-right font-medium" style="${cs}">${fmt.inr2(h.current_price)}</td>
      <td class="text-right col-hide-mobile" style="${dcs}">${dcStr}</td>
      <td class="text-right text-slate-400 col-hide-mobile">${fmt.inr(h.invested)}</td>
      <td class="text-right font-medium text-white">${fmt.inr(h.current_value)}</td>
      <td class="text-right" style="${cs}">${pnl >= 0 ? '+' : ''}${fmt.inr(pnl)}</td>
      <td class="text-right"><span class="badge ${tag}">${fmt.pct(pct)}</span></td>
      <td class="text-right text-slate-500 col-hide-mobile" style="font-size:0.75rem">${weight.toFixed(1)}%</td>
    </tr>`;
  }).join('');

  // Mobile cards
  const cardsEl = document.getElementById('holdings-cards');
  if (cardsEl) {
    cardsEl.innerHTML = sorted.map(h => {
      const pct  = h.pnl_pct ?? 0;
      const pnl  = h.pnl    ?? 0;
      const cs   = pct > 0 ? '#34d399' : pct < 0 ? '#f87171' : '#94a3b8';
      const tag  = pct > 0 ? 'tag-up' : pct < 0 ? 'tag-down' : 'tag-neutral';
      const editBtn = canEdit
        ? `<button onclick="showEditModal('${escHtml(h.ticker)}')" class="btn-sm btn-edit" style="padding:3px 8px;font-size:0.7rem">✎</button>`
        : '';
      const delBtn = canEdit
        ? `<button onclick="removeHolding('${escHtml(h.ticker)}')" class="btn-sm btn-danger" style="padding:3px 8px;font-size:0.7rem">✕</button>`
        : '';
      return `<div class="m-card">
        <div class="flex items-center justify-between mb-2">
          <a href="${tvUrl(h.ticker)}" target="_blank" rel="noopener" class="ticker-chip" style="color:#a5b4fc;text-decoration:none">${h.display} ↗</a>
          <div class="flex gap-1">${editBtn}${delBtn}</div>
        </div>
        <div class="flex justify-between items-center">
          <div>
            <div class="text-xs text-slate-500">CMP / Cost</div>
            <div class="text-sm font-medium" style="color:${cs}">${fmt.inr2(h.current_price)}</div>
            <div class="text-xs text-slate-500">${fmt.inr2(h.avg_buy_price)}</div>
          </div>
          <div class="text-right">
            <div class="text-xs text-slate-500">Value / Invested</div>
            <div class="text-sm font-medium text-white">${fmt.inr(h.current_value)}</div>
            <div class="text-xs text-slate-500">${fmt.inr(h.invested)}</div>
          </div>
          <div class="text-right">
            <div><span class="badge ${tag}">${fmt.pct(pct)}</span></div>
            <div class="text-xs mt-1" style="color:${cs}">${pnl >= 0 ? '+' : ''}${fmt.inr(pnl)}</div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  const ti  = sorted.reduce((s,h) => s + (h.invested??0), 0);
  const tc  = sorted.reduce((s,h) => s + (h.current_value??0), 0);
  const tp  = tc - ti;
  const tpc = ti ? tp/ti*100 : 0;
  document.getElementById('holdings-footer').innerHTML =
    `${sorted.length} stocks &nbsp;|&nbsp; Invested: ${fmt.inr(ti)} &nbsp;|&nbsp; Value: ${fmt.inr(tc)} &nbsp;|&nbsp; P&L: <span style="${tpc>=0?'color:#34d399':'color:#f87171'}">${tpc>=0?'+':''}${fmt.inr(tp)} (${fmt.pct(tpc)})</span>`;
}

function sortTable(key) {
  if (_sortKey === key) _sortAsc = !_sortAsc;
  else { _sortKey = key; _sortAsc = false; }
  document.querySelectorAll('th').forEach(th => th.classList.remove('sort-asc','sort-desc'));
  document.querySelectorAll('th').forEach(th => {
    if (th.textContent.trim().toLowerCase().startsWith(key.replace('_',' ')))
      th.classList.add(_sortAsc ? 'sort-asc' : 'sort-desc');
  });
  renderTable();
}

function filterTable(val) { _filter = val; renderTable(); }

// ── MUTUAL FUNDS ─────────────────────────────────────────────────────────────
async function loadMF() {
  let funds = [];
  try {
    const d = await loadJSON(PATHS.mf);
    funds = d.funds ?? [];
    const ts = d.timestamp ? 'NAV as of ' + fmt.ts(d.timestamp) : '';
    document.getElementById('mf-updated').textContent = ts;

    // Build NAV map for use by user portfolio view
    _navMap = {};
    funds.forEach(f => { _navMap[String(f.scheme_code)] = f.current_nav; });

    if (_currentUser) {
      // Logged-in: re-render with Firestore MF data + fresh NAVs
      const mfView = computeMFView(_userMFFunds, _navMap);
      _mfFunds  = mfView;
      _mfTotals = {
        invested: mfView.reduce((s, f) => s + f.invested, 0),
        current:  mfView.reduce((s, f) => s + f.current_value, 0),
        count:    mfView.length,
      };
      renderMFTable(mfView);
      renderSipSettings(mfView);
    } else {
      _mfTotals = {
        invested: d.total_invested ?? funds.reduce((s,f) => s + (f.invested ?? 0), 0),
        current:  d.total_current  ?? funds.reduce((s,f) => s + (f.current_value ?? 0), 0),
        count:    funds.length,
      };
      _mfFunds = funds;
      renderMFTable(funds);
      renderSipSettings(funds);
    }
  } catch (_) {
    document.getElementById('mf-updated').textContent = 'No MF snapshot yet — add funds to mf_portfolio.json';
    _mfTotals = { invested: 0, current: 0, count: 0 };
    _mfFunds  = [];
    renderMFTable([]);
    renderSipSettings([]);
  }

  updateCombinedStats();
  renderAdhocList();
}

function renderMFTable(funds) {
  const tbody = document.getElementById('mf-body');

  // Apply filter
  const filtered = funds.filter(f =>
    !_mfFilter ||
    (f.name ?? '').toLowerCase().includes(_mfFilter.toLowerCase()) ||
    String(f.scheme_code).includes(_mfFilter)
  );

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-slate-600 py-8 text-xs">
      ${funds.length ? 'No funds match your search.' : 'No MF data yet. Add funds to <code>mf_portfolio.json</code> and run the MF update agent.'}
    </td></tr>`;
    document.getElementById('mf-footer').textContent = '';
    return;
  }

  const totalCurrent = filtered.reduce((s, f) => s + (f.current_value ?? 0), 0);

  // Apply sort
  const sorted = [...filtered].sort((a, b) => {
    if (_mfSortKey === 'weight') {
      const aw = totalCurrent ? (a.current_value ?? 0) / totalCurrent : 0;
      const bw = totalCurrent ? (b.current_value ?? 0) / totalCurrent : 0;
      return _mfSortAsc ? aw - bw : bw - aw;
    }
    const av = _mfSortKey === 'name' ? (a.name ?? '') : (a[_mfSortKey] ?? 0);
    const bv = _mfSortKey === 'name' ? (b.name ?? '') : (b[_mfSortKey] ?? 0);
    if (typeof av === 'string') return _mfSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    return _mfSortAsc ? av - bv : bv - av;
  });

  const canEdit = !!_currentUser;
  tbody.innerHTML = sorted.map(f => {
    const pct      = f.pnl_pct ?? 0;
    const pnl      = f.pnl     ?? 0;
    const cs       = pct > 0 ? 'color:#34d399' : pct < 0 ? 'color:#f87171' : 'color:#94a3b8';
    const tag      = pct > 0 ? 'tag-up' : pct < 0 ? 'tag-down' : 'tag-neutral';
    const shortName = f.name?.length > 36 ? f.name.slice(0, 34) + '…' : (f.name ?? '—');
    const weight   = totalCurrent > 0 ? (f.current_value ?? 0) / totalCurrent * 100 : 0;
    const editBtn  = canEdit
      ? `<button onclick="showEditMFModal('${escHtml(String(f.scheme_code))}')" title="Edit" class="btn-sm btn-edit ml-1" style="padding:2px 5px;font-size:0.65rem">✎</button>`
      : '';
    const delBtn   = canEdit
      ? `<button onclick="removeMutualFund('${escHtml(String(f.scheme_code))}')" title="Remove" class="btn-sm btn-danger ml-1" style="padding:2px 5px;font-size:0.65rem">✕</button>`
      : '';
    return `<tr>
      <td class="text-slate-200 text-xs" title="${escHtml(f.name ?? '')}">${escHtml(shortName)}${editBtn}${delBtn}</td>
      <td class="text-right text-slate-300">${f.units?.toLocaleString('en-IN',{maximumFractionDigits:3}) ?? '—'}</td>
      <td class="text-right text-slate-400">${fmt.inr2(f.avg_nav)}</td>
      <td class="text-right font-medium" style="${cs}">${fmt.inr2(f.current_nav)}</td>
      <td class="text-right text-slate-400 col-hide-mobile">${fmt.inr(f.invested)}</td>
      <td class="text-right font-medium text-white">${fmt.inr(f.current_value)}</td>
      <td class="text-right" style="${cs}">${pnl >= 0 ? '+' : ''}${fmt.inr(pnl)}</td>
      <td class="text-right"><span class="badge ${tag}">${fmt.pct(pct)}</span></td>
      <td class="text-right text-slate-500 col-hide-mobile" style="font-size:0.75rem">${weight.toFixed(1)}%</td>
    </tr>`;
  }).join('');

  const ti  = sorted.reduce((s,f) => s + (f.invested??0), 0);
  const tc  = sorted.reduce((s,f) => s + (f.current_value??0), 0);
  const tp  = tc - ti;
  const tpc = ti ? tp/ti*100 : 0;
  document.getElementById('mf-footer').innerHTML =
    `${sorted.length} funds &nbsp;|&nbsp; Invested: ${fmt.inr(ti)} &nbsp;|&nbsp; Value: ${fmt.inr(tc)} &nbsp;|&nbsp; P&L: <span style="${tpc>=0?'color:#34d399':'color:#f87171'}">${tpc>=0?'+':''}${fmt.inr(tp)} (${fmt.pct(tpc)})</span>`;
}

function getSipSetting(schemeCode, defaults) {
  const saved = JSON.parse(localStorage.getItem('sip_' + schemeCode) || 'null');
  return saved ?? defaults;
}

function saveSipSetting(schemeCode, amount, date) {
  localStorage.setItem('sip_' + schemeCode, JSON.stringify({ amount: Number(amount), date: Number(date) }));
  updateSipTotal(_mfFunds);
}

function renderSipSettings(funds) {
  const el = document.getElementById('sip-list');
  if (!funds.length) {
    el.innerHTML = '<p class="text-xs text-slate-600">No funds loaded yet.</p>';
    document.getElementById('sip-total').textContent = '—';
    return;
  }
  el.innerHTML = funds.map(f => {
    const sip      = getSipSetting(f.scheme_code, { amount: f.sip_amount ?? 0, date: f.sip_date ?? 1 });
    const short    = f.name?.length > 32 ? f.name.slice(0,30) + '…' : (f.name ?? f.scheme_code);
    const lastSip  = f.last_sip_recorded ?? '';
    const lastBadge = lastSip
      ? `<span class="text-xs text-green-500 flex-shrink-0" title="Last SIP recorded">✓ ${fmt.date(lastSip)}</span>`
      : `<span class="text-xs text-slate-600 flex-shrink-0">not recorded yet</span>`;
    return `<div class="py-2 border-b border-slate-800 last:border-0">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="text-xs text-slate-300 flex-1 min-w-0 truncate" title="${f.name ?? ''}">${short}</span>
        ${sip.amount > 0 ? lastBadge : ''}
      </div>
      <div class="flex items-center gap-1">
        <span class="text-xs text-slate-500">₹</span>
        <input type="number" class="sip-input" value="${sip.amount}" placeholder="0"
               onchange="saveSipSetting('${f.scheme_code}', this.value, this.closest('div').querySelector('.sip-date').value)"
               title="Monthly SIP amount" />
        <span class="text-xs text-slate-500 ml-1">on day</span>
        <input type="number" class="sip-input sip-date" value="${sip.date}" min="1" max="31" placeholder="1"
               style="width:52px"
               onchange="saveSipSetting('${f.scheme_code}', this.closest('div').querySelector('input[type=number]:not(.sip-date)').value, this.value)"
               title="Day of month" />
        <span class="text-xs text-slate-500">of month</span>
      </div>
    </div>`;
  }).join('');
  updateSipTotal(funds);
}

function updateSipTotal(funds) {
  if (!funds) {
    document.getElementById('sip-total').textContent = '—';
    return;
  }
  const total = funds.reduce((s, f) => {
    const sip = getSipSetting(f.scheme_code, { amount: f.sip_amount ?? 0, date: f.sip_date ?? 1 });
    return s + (sip.amount || 0);
  }, 0);
  document.getElementById('sip-total').textContent = fmt.inr(total) + ' / month';
}

function addAdhoc() {
  const fund   = document.getElementById('adhoc-fund').value.trim();
  const amount = parseFloat(document.getElementById('adhoc-amount').value);
  const date   = document.getElementById('adhoc-date').value;
  const note   = document.getElementById('adhoc-note').value.trim();

  if (!fund || !amount || !date) { showToast('Fund name, amount, and date are required.', 'error'); return; }

  const list = JSON.parse(localStorage.getItem('adhoc_investments') || '[]');
  list.unshift({ fund, amount, date, note, id: Date.now() });
  localStorage.setItem('adhoc_investments', JSON.stringify(list));

  document.getElementById('adhoc-fund').value   = '';
  document.getElementById('adhoc-amount').value = '';
  document.getElementById('adhoc-date').value   = '';
  document.getElementById('adhoc-note').value   = '';
  renderAdhocList();
}

function deleteAdhoc(id) {
  const list = JSON.parse(localStorage.getItem('adhoc_investments') || '[]').filter(x => x.id !== id);
  localStorage.setItem('adhoc_investments', JSON.stringify(list));
  renderAdhocList();
}

function renderAdhocList() {
  const list = JSON.parse(localStorage.getItem('adhoc_investments') || '[]');
  const el   = document.getElementById('adhoc-list');
  if (!list.length) {
    el.innerHTML = '<p class="text-xs text-slate-600">No adhoc investments logged yet.</p>';
    return;
  }
  const total = list.reduce((s,x) => s + x.amount, 0);
  el.innerHTML = `
    <div class="text-xs text-slate-500 mb-2">${list.length} entries · Total: <strong class="text-white">${fmt.inr(total)}</strong></div>
    <div style="max-height:220px;overflow-y:auto;" class="space-y-1">
      ${list.map(x => `
        <div class="flex items-center justify-between gap-3 p-2 rounded-lg" style="background:#0f172a;border:1px solid #334155">
          <div class="flex-1 min-w-0">
            <span class="text-xs font-medium text-slate-200">${x.fund}</span>
            ${x.note ? `<span class="text-xs text-slate-500 ml-2">· ${x.note}</span>` : ''}
          </div>
          <span class="text-xs font-semibold text-white flex-shrink-0">${fmt.inr(x.amount)}</span>
          <span class="text-xs text-slate-500 flex-shrink-0">${fmt.date(x.date)}</span>
          <button onclick="deleteAdhoc(${x.id})" class="btn-sm btn-danger flex-shrink-0">✕</button>
        </div>`).join('')}
    </div>`;
}

function generateSIPPortfolioJSON() {
  if (!_mfFunds.length) { showToast('Load the Mutual Funds tab first.', 'warn'); return; }

  const funds = _mfFunds.map(f => {
    const sip = getSipSetting(f.scheme_code, { amount: f.sip_amount ?? 0, date: f.sip_date ?? 1 });
    return {
      name:        f.name,
      scheme_code: f.scheme_code,
      units:       f.units,
      avg_nav:     f.avg_nav,
      sip_amount:  sip.amount,
      sip_date:    sip.date,
    };
  });

  document.getElementById('sip-json-output').textContent = JSON.stringify({ funds }, null, 2);
  document.getElementById('sip-json-section').classList.remove('hidden');
  document.getElementById('sip-json-section').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function copySIPJson(btn) {
  navigator.clipboard.writeText(document.getElementById('sip-json-output').textContent).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = orig, 1500);
  });
}

// ── HOLDINGS SUB-TABS ────────────────────────────────────────────────────────
function switchHoldingsTab(name) {
  ['stocks','mf'].forEach(t => {
    document.getElementById('hpanel-' + t).classList.toggle('hidden', t !== name);
    document.getElementById('htab-' + t).classList.toggle('active', t === name);
  });
  if (name === 'mf') loadMF();
}

// ── NEWS ─────────────────────────────────────────────────────────────────────
function newsItem(ticker, n) {
  const display = ticker.replace('.NS','').replace('.BO','');
  const link    = n.link && n.link !== '#' ? safeHref(n.link) : null;
  const title   = escHtml(n.title);
  return `
    <div class="news-item">
      ${link
        ? `<a href="${link}" target="_blank" rel="noopener"
              class="text-xs font-medium text-slate-300 hover:text-white leading-relaxed block">${title}</a>`
        : `<p class="text-xs font-medium text-slate-400 leading-relaxed">${title}</p>`}
      <div class="flex items-center gap-2 mt-1.5">
        <a href="${tvUrl(ticker)}" target="_blank" rel="noopener"
           class="badge tag-neutral hover:opacity-80 transition-opacity" style="text-decoration:none">${display} ↗</a>
        <span class="text-xs text-slate-600">${escHtml(n.publisher || '')} ${n.age_h ? '· ' + n.age_h + 'h ago' : ''}</span>
        ${link ? `<a href="${link}" target="_blank" rel="noopener" class="text-xs text-indigo-400 hover:text-indigo-300 ml-auto flex-shrink-0">Read →</a>` : ''}
      </div>
    </div>`;
}

async function loadNews() {
  const d = await loadJSON(PATHS.news);
  document.getElementById('news-date').textContent = d.date ? 'Digest for ' + d.date : '';

  const hn     = d.holding_news ?? {};
  const hnKeys = Object.keys(hn);
  const hEl    = document.getElementById('news-holdings');
  hEl.innerHTML = hnKeys.length
    ? hnKeys.slice(0,10).flatMap(t => (hn[t] ?? []).slice(0,1).map(n => newsItem(t, n))).join('')
    : '<p class="text-xs text-slate-600">No news fetched yet</p>';

  const mh  = d.market_headlines ?? [];
  const mEl = document.getElementById('news-market');
  mEl.innerHTML = mh.length
    ? mh.slice(0,8).map(h => {
        const mhLink  = h.link ? safeHref(h.link) : null;
        const mhTitle = escHtml(h.title);
        return `
        <div class="news-item">
          ${mhLink ? `<a href="${mhLink}" target="_blank" rel="noopener"
                         class="text-xs font-medium text-slate-300 hover:text-white leading-relaxed block">${mhTitle}</a>`
                   : `<p class="text-xs text-slate-400 leading-relaxed">${mhTitle}</p>`}
          <div class="flex items-center gap-2 mt-1">
            <span class="text-xs text-slate-600">${escHtml(h.source ?? '')}</span>
            ${mhLink ? `<a href="${mhLink}" target="_blank" rel="noopener" class="text-xs text-indigo-400 hover:text-indigo-300 ml-auto">Read →</a>` : ''}
          </div>
        </div>`;
      }).join('')
    : '<p class="text-xs text-slate-600">No headlines yet. Add feedparser to requirements.txt</p>';

  const mn     = d.momentum_news ?? {};
  const mnKeys = Object.keys(mn);
  const wEl    = document.getElementById('news-momentum');
  wEl.innerHTML = mnKeys.length
    ? mnKeys.slice(0,12).flatMap(t => (mn[t] ?? []).slice(0,1).map(n => {
        const display  = t.replace('.NS','').replace('.BO','');
        const mnLink   = n.link ? safeHref(n.link) : null;
        const mnTitle  = escHtml(n.title);
        return `<div class="news-item">
          <div class="flex items-center gap-2 mb-1">
            <a href="${tvUrl(t)}" target="_blank" rel="noopener"
               class="badge hover:opacity-80 transition-opacity" style="background:rgba(99,102,241,0.15);color:#818cf8;border:1px solid rgba(99,102,241,0.3);text-decoration:none">${display} ↗</a>
          </div>
          ${mnLink
            ? `<a href="${mnLink}" target="_blank" rel="noopener" class="text-xs text-slate-400 hover:text-white leading-relaxed block">${mnTitle}</a>
               <a href="${mnLink}" target="_blank" rel="noopener" class="text-xs text-indigo-400 hover:text-indigo-300 mt-1 block">Read →</a>`
            : `<p class="text-xs text-slate-500">${mnTitle}</p>`}
        </div>`;
      })).join('')
    : '<p class="text-xs text-slate-600">No watchlist news yet</p>';
}

// ── RECOMMENDATIONS ──────────────────────────────────────────────────────────
async function loadRecommendations() {
  const d = await loadJSON(PATHS.recommendations);
  document.getElementById('rec-date').textContent = d.timestamp ? 'Generated ' + fmt.ts(d.timestamp) : '';
  document.getElementById('rec-note').textContent = d.investment_note || '';

  const recs = d.recommendations ?? [];
  if (!recs.length) {
    document.getElementById('rec-list').innerHTML = '<p class="text-xs text-slate-600">No recommendations yet</p>';
    return;
  }

  const actionClass = a => {
    if (a.includes('STRONG'))     return 'action-green';
    if (a.includes('ACCUMULATE')) return 'action-blue';
    if (a.includes('REVIEW'))     return 'action-red';
    if (a.includes('MONITOR'))    return 'action-yellow';
    return 'action-gray';
  };

  document.getElementById('rec-list').innerHTML = recs.map(r => `
    <div class="${actionClass(r.action)} rounded-lg p-3 mb-2">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-2">
          <span class="text-lg">${r.action_emoji || '⚪'}</span>
          <div>
            <a href="${tvUrl(r.ticker)}" target="_blank" rel="noopener"
               class="font-semibold text-sm hover:opacity-80 transition-opacity" style="text-decoration:none">${r.display} ↗</a>
            <span class="text-xs ml-2 opacity-70">${r.sector || ''}</span>
          </div>
        </div>
        <div class="text-right flex-shrink-0">
          <div class="text-xs font-medium" style="${(r.pnl_pct??0)>=0?'color:#34d399':'color:#f87171'}">${fmt.pct(r.pnl_pct)}</div>
          <div class="text-xs opacity-60">Score: ${r.momentum_score >= 0 ? '+' : ''}${r.momentum_score}</div>
        </div>
      </div>
      <div class="mt-1.5 text-xs font-semibold">${r.action}</div>
      <div class="mt-1 flex flex-wrap gap-1">
        ${(r.signals||[]).slice(0,3).map(s => `<span class="text-xs opacity-70">• ${s}</span>`).join(' ')}
      </div>
      <div class="mt-1.5 flex gap-3 text-xs opacity-50">
        ${r.rsi ? `RSI: ${r.rsi}` : ''} ${r.trend ? `· ${r.trend}` : ''} ${r.macd ? `· ${r.macd}` : ''}
      </div>
    </div>`).join('');
}

// ── CORPORATE ACTIONS ────────────────────────────────────────────────────────
function caCard(ev) {
  const typeColor = t => {
    if (t === 'Dividend')       return '#34d399';
    if (t === 'Stock Split')    return '#818cf8';
    if (t.includes('Earnings')) return '#facc15';
    return '#94a3b8';
  };
  const icon   = ev.type === 'Dividend' ? '💰' : ev.type === 'Stock Split' ? '✂️' : '📅';
  const today  = todayStr();
  const daysTo = Math.round((new Date(ev.date) - new Date(today)) / 86400000);
  let dateBadge = '';
  if (daysTo >= 0 && daysTo <= 7)  dateBadge = `<span class="badge tag-soon ml-1">${daysTo === 0 ? 'Today' : 'In ' + daysTo + 'd'}</span>`;
  else if (daysTo > 7)              dateBadge = `<span class="badge tag-neutral ml-1">In ${daysTo}d</span>`;

  return `
    <div class="flex items-center justify-between gap-4 p-3 rounded-lg" style="background:rgba(15,23,42,0.5);border:1px solid #334155">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
             style="background:rgba(30,41,59,1);font-size:0.8rem;color:${typeColor(ev.type)}">${icon}</div>
        <div>
          <div class="flex items-center gap-1">
            <a href="${tvUrl(ev.ticker)}" target="_blank" rel="noopener"
               class="font-semibold text-sm text-white hover:text-indigo-300 transition-colors" style="text-decoration:none">${ev.display} ↗</a>
            ${ev.in_portfolio ? '<span class="text-xs text-indigo-400">📂</span>' : ''}
          </div>
          <div class="text-xs text-slate-500 mt-0.5">${ev.type}${ev.detail ? ' · ' + ev.detail : ''}</div>
        </div>
      </div>
      <div class="text-right flex-shrink-0">
        <div class="text-xs text-slate-400">${fmt.date(ev.date)}</div>
        ${dateBadge}
      </div>
    </div>`;
}

async function loadCorporate() {
  const d          = await loadJSON(PATHS.corporate);
  const highlights = d.highlights ?? [];
  const today      = todayStr();

  const upcoming = highlights.filter(ev => ev.date >= today).sort((a,b) => a.date.localeCompare(b.date));
  const past     = highlights.filter(ev => ev.date <  today).sort((a,b) => b.date.localeCompare(a.date));

  const upEl = document.getElementById('ca-upcoming');
  upEl.innerHTML = upcoming.length
    ? upcoming.map(caCard).join('')
    : '<p class="text-xs text-slate-600 py-2">No upcoming events</p>';

  const pastEl = document.getElementById('ca-past');
  pastEl.innerHTML = past.length
    ? past.map(caCard).join('')
    : '<p class="text-xs text-slate-600 py-2">No past events</p>';
}

// ── ADD TO PORTFOLIO ──────────────────────────────────────────────────────────
function switchAddTab(name) {
  ['stock','mf','bulk'].forEach(t => {
    document.getElementById('addpanel-' + t).classList.toggle('hidden', t !== name);
    document.getElementById('addtab-' + t).classList.toggle('active', t === name);
  });
}

function detectCurrency() {
  const ticker = document.getElementById('add-stock-ticker').value.trim().toUpperCase();
  const cur    = (ticker.endsWith('.NS') || ticker.endsWith('.BO')) ? 'INR' : (ticker ? 'USD' : 'INR');
  document.getElementById('add-stock-currency').value = cur;
  document.getElementById('add-stock-currency-sym').textContent = cur === 'USD' ? '$' : '₹';
  const hint = ticker.endsWith('.NS') ? '✓ NSE — National Stock Exchange'
             : ticker.endsWith('.BO') ? '✓ BSE — Bombay Stock Exchange'
             : ticker                 ? '✓ US Market (NYSE / NASDAQ)'
             :                         'Suffix: .NS = NSE · .BO = BSE · none = US';
  document.getElementById('add-stock-currency-hint').textContent = hint;
  generateStockJSON();
}

function generateStockJSON() {
  const ticker = (document.getElementById('add-stock-ticker').value.trim() || '').toUpperCase();
  const qty    = parseFloat(document.getElementById('add-stock-qty').value);
  const price  = parseFloat(document.getElementById('add-stock-price').value);
  const cur    = document.getElementById('add-stock-currency').value || 'INR';
  const out    = document.getElementById('add-stock-output');
  if (!ticker || !qty || !price) { out.classList.add('hidden'); return; }
  const obj = { ticker, qty, avg_buy_price: price, currency: cur };
  document.getElementById('add-stock-json-text').textContent = JSON.stringify(obj, null, 2) + ',';
  out.classList.remove('hidden');
}

function generateMFJSON() {
  const name  = document.getElementById('add-mf-name').value.trim();
  const code  = document.getElementById('add-mf-code').value.trim();
  const units = parseFloat(document.getElementById('add-mf-units').value);
  const nav   = parseFloat(document.getElementById('add-mf-nav').value);
  const sip   = parseFloat(document.getElementById('add-mf-sip').value) || 0;
  const sipd  = parseInt(document.getElementById('add-mf-sipdate').value) || 1;
  const out   = document.getElementById('add-mf-output');
  if (!name || !code || !units || !nav) { out.classList.add('hidden'); return; }
  const obj = { name, scheme_code: code, units, avg_nav: nav, sip_amount: sip, sip_date: sipd };
  document.getElementById('add-mf-json-text').textContent = JSON.stringify(obj, null, 2) + ',';
  out.classList.remove('hidden');
}

function copyJSON(elementId, btn) {
  navigator.clipboard.writeText(document.getElementById(elementId).textContent).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = orig, 1500);
  });
}

const _PROMPTS = {
  stock: `Extract from this Indian broker screenshot: ticker symbol (add .NS for NSE stocks, .BO for BSE), quantity, average buy price. JSON only: {"ticker":"...","qty":...,"avg_buy_price":...,"currency":"INR"}`,
  mf:    `Extract from this MF holding screenshot: full fund name, mfapi.in numeric scheme code (look it up on mfapi.in if needed), units held, average NAV. JSON only: {"name":"...","scheme_code":"...","units":...,"avg_nav":...,"sip_amount":0,"sip_date":1}`,
};

function copyPrompt(type, btn) {
  navigator.clipboard.writeText(_PROMPTS[type]).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = orig, 1500);
  });
}

// ── FIRESTORE-BACKED ADD / REMOVE ─────────────────────────────────────────────

async function addStockToFirestore() {
  if (!_currentUser || !db) { showAuthModal('signin'); return; }
  const ticker = (document.getElementById('add-stock-ticker').value.trim() || '').toUpperCase();
  const qty    = parseFloat(document.getElementById('add-stock-qty').value);
  const price  = parseFloat(document.getElementById('add-stock-price').value);
  const cur    = document.getElementById('add-stock-currency').value || 'INR';
  if (!ticker || !qty || !price) { showToast('Please fill in all required fields.', 'error'); return; }
  try {
    await saveHolding(_currentUser.uid, { ticker, qty, avg_buy_price: price, currency: cur });
    showToast(ticker + ' saved to portfolio', 'success');
    const succ = document.getElementById('add-stock-save-success');
    if (succ) { succ.classList.remove('hidden'); setTimeout(() => succ.classList.add('hidden'), 3000); }
    await loadUserPortfolio(_currentUser.uid);
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

async function addMFToFirestore() {
  if (!_currentUser || !db) { showAuthModal('signin'); return; }
  const name  = document.getElementById('add-mf-name').value.trim();
  const code  = document.getElementById('add-mf-code').value.trim();
  const units = parseFloat(document.getElementById('add-mf-units').value);
  const nav   = parseFloat(document.getElementById('add-mf-nav').value);
  const sip   = parseFloat(document.getElementById('add-mf-sip').value) || 0;
  const sipd  = parseInt(document.getElementById('add-mf-sipdate').value) || 1;
  if (!name || !code || !units || !nav) { showToast('Please fill in all required fields.', 'error'); return; }
  try {
    await saveMutualFund(_currentUser.uid, { name, scheme_code: code, units, avg_nav: nav, sip_amount: sip, sip_date: sipd });
    showToast('Fund saved to portfolio', 'success');
    const succ = document.getElementById('add-mf-save-success');
    if (succ) { succ.classList.remove('hidden'); setTimeout(() => succ.classList.add('hidden'), 3000); }
    await loadUserPortfolio(_currentUser.uid);
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

async function removeHolding(ticker) {
  if (!_currentUser || !db) return;
  showConfirm(`Remove ${ticker} from your portfolio?`, async () => {
    try {
      await deleteHolding(_currentUser.uid, ticker);
      showToast(ticker + ' removed', 'success');
      await loadUserPortfolio(_currentUser.uid);
    } catch (e) {
      showToast('Remove failed: ' + e.message, 'error');
    }
  });
}

function updateAddTabForAuth(user) {
  const saveStockBtn = document.getElementById('add-stock-save-btn');
  const saveStockJsonBtn = document.getElementById('add-stock-json-btn');
  const saveMFBtn    = document.getElementById('add-mf-save-btn');
  const saveMFJsonBtn = document.getElementById('add-mf-json-btn');
  if (saveStockBtn) saveStockBtn.classList.toggle('hidden', !user);
  if (saveStockJsonBtn) {
    saveStockJsonBtn.textContent = user ? 'Generate JSON (backup)' : 'Generate JSON →';
  }
  if (saveMFBtn)    saveMFBtn.classList.toggle('hidden', !user);
  if (saveMFJsonBtn) {
    saveMFJsonBtn.textContent = user ? 'Generate JSON (backup)' : 'Generate JSON →';
  }
}

// ── BULK IMPORT ──────────────────────────────────────────────────────────────
let _bulkData = { holdings: [], funds: [] };

function previewBulkImport() {
  const raw = document.getElementById('bulk-paste').value.trim();
  let parsed;
  try { parsed = JSON.parse(raw); } catch(_) { showToast('Invalid JSON — check for missing commas or brackets.', 'error'); return; }

  if (Array.isArray(parsed)) {
    _bulkData = { holdings: parsed, funds: [] };
  } else {
    _bulkData = {
      holdings: Array.isArray(parsed.holdings) ? parsed.holdings : [],
      funds:    Array.isArray(parsed.funds)    ? parsed.funds    : [],
    };
  }

  if (!_bulkData.holdings.length && !_bulkData.funds.length) {
    showToast('No holdings or funds found in the pasted JSON.', 'error');
    return;
  }

  const parts = [];
  if (_bulkData.holdings.length) parts.push(_bulkData.holdings.length + ' stocks');
  if (_bulkData.funds.length)    parts.push(_bulkData.funds.length + ' mutual funds');
  document.getElementById('bulk-summary').textContent = 'Ready to import: ' + parts.join(' + ');

  const stockList = document.getElementById('bulk-stock-list');
  if (_bulkData.holdings.length) {
    stockList.innerHTML = '<div class="text-xs text-slate-500 font-semibold mb-1">Stocks</div>' +
      _bulkData.holdings.map(h =>
        '<div class="flex justify-between text-xs py-1 px-2 rounded" style="background:#0f172a">' +
          '<span class="text-slate-200 font-mono">' + escHtml(h.ticker) + '</span>' +
          '<span class="text-slate-400">' + escHtml(h.qty) + ' &times; ' + (h.currency === 'USD' ? '$' : '₹') + escHtml(h.avg_buy_price) + '</span>' +
        '</div>'
      ).join('');
    stockList.classList.remove('hidden');
  } else {
    stockList.classList.add('hidden');
  }

  const mfList = document.getElementById('bulk-mf-list');
  if (_bulkData.funds.length) {
    mfList.innerHTML = '<div class="text-xs text-slate-500 font-semibold mb-1">Mutual Funds</div>' +
      _bulkData.funds.map(f =>
        '<div class="flex justify-between text-xs py-1 px-2 rounded" style="background:#0f172a">' +
          '<span class="text-slate-300 truncate" style="max-width:65%">' + escHtml(f.name) + '</span>' +
          '<span class="text-slate-400 flex-shrink-0">' + escHtml(f.units) + ' units @ ₹' + escHtml(f.avg_nav) + '</span>' +
        '</div>'
      ).join('');
    mfList.classList.remove('hidden');
  } else {
    mfList.classList.add('hidden');
  }

  document.getElementById('bulk-success').classList.add('hidden');
  const btn = document.getElementById('bulk-import-btn');
  btn.disabled = false;
  btn.textContent = 'Import All to Portfolio';
  document.getElementById('bulk-preview').classList.remove('hidden');
}

async function bulkImportAll() {
  if (!_currentUser) { showAuthModal('signin'); return; }
  const btn = document.getElementById('bulk-import-btn');
  btn.disabled = true;
  btn.textContent = 'Importing…';
  try {
    if (_bulkData.holdings.length) await bulkImportHoldings(_currentUser.uid, _bulkData.holdings);
    if (_bulkData.funds.length)    await bulkImportMutualFunds(_currentUser.uid, _bulkData.funds);
    document.getElementById('bulk-success').classList.remove('hidden');
    btn.textContent = '✓ Done';
    await loadUserPortfolio(_currentUser.uid);
    showToast('All holdings imported successfully!', 'success');
  } catch(e) {
    showToast('Import failed: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Import All to Portfolio';
  }
}

function parseStockPaste() {
  try {
    const raw = document.getElementById('add-stock-paste').value.trim();
    const parsed = JSON.parse(raw);

    // Array pasted → route to Bulk Import tab
    if (Array.isArray(parsed)) {
      document.getElementById('bulk-paste').value = raw;
      switchAddTab('bulk');
      previewBulkImport();
      return;
    }

    // Single object → fill form fields
    if (parsed.ticker) document.getElementById('add-stock-ticker').value = parsed.ticker.toUpperCase();
    if (parsed.qty   ) document.getElementById('add-stock-qty').value   = parsed.qty;
    if (parsed.avg_buy_price) document.getElementById('add-stock-price').value = parsed.avg_buy_price;
    detectCurrency();
    generateStockJSON();

    // If logged in, trigger save directly
    if (_currentUser) {
      addStockToFirestore();
    }
  } catch(_) { showToast('Invalid JSON — please paste the raw JSON block returned by the AI.', 'error'); }
}

function parseMFPaste() {
  try {
    const obj = JSON.parse(document.getElementById('add-mf-paste').value.trim());
    if (obj.name        ) document.getElementById('add-mf-name').value    = obj.name;
    if (obj.scheme_code ) document.getElementById('add-mf-code').value    = String(obj.scheme_code);
    if (obj.units       ) document.getElementById('add-mf-units').value   = obj.units;
    if (obj.avg_nav     ) document.getElementById('add-mf-nav').value     = obj.avg_nav;
    if (obj.sip_amount  ) document.getElementById('add-mf-sip').value     = obj.sip_amount;
    if (obj.sip_date    ) document.getElementById('add-mf-sipdate').value = obj.sip_date;
    generateMFJSON();
  } catch(_) { showToast('Invalid JSON — please paste the raw JSON block returned by the AI.', 'error'); }
}

// ── TAB SWITCHING ────────────────────────────────────────────────────────────
const PANELS = ['holdings','news','recommendations','corporate','performance','add'];

function switchTab(name) {
  PANELS.forEach(p => {
    document.getElementById('panel-' + p).classList.toggle('hidden', p !== name);
    document.getElementById('tab-'   + p).classList.toggle('active', p === name);
  });
  if (name === 'performance' && _currentUser) triggerRecalculate();
}

// ── REFRESH ALL ──────────────────────────────────────────────────────────────
async function loadMFTotalsOnly() {
  try {
    const d = await loadJSON(PATHS.mf);
    const funds = d.funds ?? [];
    _mfTotals = {
      invested: d.total_invested ?? funds.reduce((s,f) => s + (f.invested ?? 0), 0),
      current:  d.total_current  ?? funds.reduce((s,f) => s + (f.current_value ?? 0), 0),
      count:    funds.length,
    };
    updateCombinedStats();
  } catch (_) {
    // mf_snapshot not ready yet — totals stay at zero
  }
}

async function refreshAll() {
  checkMarketStatus();
  const btn = document.querySelector('button[onclick="refreshAll()"]');
  btn.textContent = '↻ Loading…';
  try {
    await Promise.allSettled([
      loadSnapshot().catch(e => console.error('snapshot:', e)),
      loadMFTotalsOnly().catch(e => console.error('mf totals:', e)),
      loadNews().catch(e => console.error('news:', e)),
      loadRecommendations().catch(e => console.error('recs:', e)),
      loadCorporate().catch(e => console.error('corporate:', e)),
    ]);
  } finally {
    btn.textContent = '↻ Refresh';
  }
}

// ── INIT ─────────────────────────────────────────────────────────────────────
document.getElementById('adhoc-date').valueAsDate = new Date();
refreshAll();
setInterval(checkMarketStatus, 60_000);

// Firebase auth state listener — runs once on load
if (isFirebaseReady()) {
  auth.onAuthStateChanged(async user => {
    _authResolved = true;
    updateAuthUI(user);
    updateAddTabForAuth(user);
    if (user) {
      // Show performance content, hide auth prompt
      const perfAuthNote = document.getElementById('perf-auth-note');
      const perfContent  = document.getElementById('perf-content');
      if (perfAuthNote) perfAuthNote.classList.add('hidden');
      if (perfContent)  perfContent.classList.remove('hidden');
      await loadUserPortfolio(user.uid);
    } else {
      await onUserSignedOut();
    }
  });
} else {
  // Firebase not configured — show sign-in button as disabled hint
  const btn = document.getElementById('header-signin-btn');
  if (btn) {
    btn.title   = 'Firebase not configured — edit docs/js/firebase-config.js';
    btn.style.opacity = '0.5';
    btn.onclick = () => showToast('Login not configured — edit docs/js/firebase.js to enable.', 'warn');
  }
  // Hide performance auth note — show disabled state
  const perfAuthNote = document.getElementById('perf-auth-note');
  if (perfAuthNote) {
    perfAuthNote.innerHTML = '<div class="card p-6 text-center space-y-2"><div class="text-3xl">⚙️</div><div class="text-sm font-semibold text-white">Firebase Not Configured</div><div class="text-xs text-slate-400">Edit <code>docs/js/firebase-config.js</code> to enable login and performance tracking.</div></div>';
  }
}
