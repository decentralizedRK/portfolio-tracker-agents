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
let _pnlChart   = null;
let _stockTotals = { invested: 0, current: 0, count: 0 };
let _mfTotals    = { invested: 0, current: 0, count: 0 };
let _mfFunds     = [];   // full fund list from snapshot, kept for SIP total + JSON generation

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
  const count    = _stockTotals.count + _mfTotals.count;

  document.getElementById('s-invested').textContent = fmt.inr(invested);
  document.getElementById('s-stocks').textContent =
    `${_stockTotals.count} stocks · ${_mfTotals.count} funds`;

  setWithColor('s-current', fmt.inr(current),                         pct, 's-current-sub', fmt.pct(pct));
  setWithColor('s-pnl',     (pnl >= 0 ? '+' : '') + fmt.inr(Math.abs(pnl)), pnl, 's-pnl-sub', fmt.pct(pct));
  setWithColor('s-pct',     fmt.pct(pct), pct);
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
    renderLeaderboard('runners-list',  d.runners  ?? [], true);
    renderLeaderboard('draggers-list', d.draggers ?? [], false);
  } else {
    // Auth still pending — show loading state, skip public render
    const tbody = document.querySelector('#holdings-table tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center text-slate-500 py-8 text-sm">Loading your portfolio…</td></tr>';
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

// ── STOCKS TABLE ─────────────────────────────────────────────────────────────
function renderTable() {
  const filtered = _holdings.filter(h =>
    !_filter || h.display.toLowerCase().includes(_filter.toLowerCase()) ||
    h.ticker.toLowerCase().includes(_filter.toLowerCase())
  );
  const sorted = [...filtered].sort((a,b) => {
    const av = a[_sortKey] ?? 0, bv = b[_sortKey] ?? 0;
    if (typeof av === 'string') return _sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    return _sortAsc ? av - bv : bv - av;
  });

  const canEdit = !!_currentUser;
  document.getElementById('holdings-body').innerHTML = sorted.map(h => {
    const pct = h.pnl_pct ?? 0;
    const pnl = h.pnl    ?? 0;
    const cs  = pct > 0 ? 'color:#34d399' : pct < 0 ? 'color:#f87171' : 'color:#94a3b8';
    const tag = pct > 0 ? 'tag-up' : pct < 0 ? 'tag-down' : 'tag-neutral';
    const delBtn = canEdit
      ? `<button onclick="removeHolding('${h.ticker}')" title="Remove" class="btn-sm btn-danger ml-1" style="padding:2px 6px;font-size:0.7rem">✕</button>`
      : '';
    return `<tr>
      <td><a href="${tvUrl(h.ticker)}" target="_blank" rel="noopener"
             class="ticker-chip hover:text-white transition-colors" style="color:#a5b4fc;text-decoration:none">${h.display} ↗</a>${delBtn}</td>
      <td class="text-right text-slate-300">${h.qty?.toLocaleString('en-IN') ?? '—'}</td>
      <td class="text-right text-slate-400">${fmt.inr2(h.avg_buy_price)}</td>
      <td class="text-right font-medium" style="${cs}">${fmt.inr2(h.current_price)}</td>
      <td class="text-right text-slate-400">${fmt.inr(h.invested)}</td>
      <td class="text-right font-medium text-white">${fmt.inr(h.current_value)}</td>
      <td class="text-right" style="${cs}">${pnl >= 0 ? '+' : ''}${fmt.inr(pnl)}</td>
      <td class="text-right"><span class="badge ${tag}">${fmt.pct(pct)}</span></td>
    </tr>`;
  }).join('');

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
  if (!funds.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-slate-600 py-8 text-xs">
      No MF data yet. Add funds to <code>mf_portfolio.json</code> and run the MF update agent.
    </td></tr>`;
    document.getElementById('mf-footer').textContent = '';
    return;
  }

  tbody.innerHTML = funds.map(f => {
    const pct = f.pnl_pct ?? 0;
    const pnl = f.pnl     ?? 0;
    const cs  = pct > 0 ? 'color:#34d399' : pct < 0 ? 'color:#f87171' : 'color:#94a3b8';
    const tag = pct > 0 ? 'tag-up' : pct < 0 ? 'tag-down' : 'tag-neutral';
    const shortName = f.name?.length > 40 ? f.name.slice(0,38) + '…' : (f.name ?? '—');
    return `<tr>
      <td class="text-slate-200 text-xs" title="${f.name ?? ''}">${shortName}</td>
      <td class="text-right text-slate-300">${f.units?.toLocaleString('en-IN',{maximumFractionDigits:3}) ?? '—'}</td>
      <td class="text-right text-slate-400">${fmt.inr2(f.avg_nav)}</td>
      <td class="text-right font-medium" style="${cs}">${fmt.inr2(f.current_nav)}</td>
      <td class="text-right text-slate-400">${fmt.inr(f.invested)}</td>
      <td class="text-right font-medium text-white">${fmt.inr(f.current_value)}</td>
      <td class="text-right" style="${cs}">${pnl >= 0 ? '+' : ''}${fmt.inr(pnl)}</td>
      <td class="text-right"><span class="badge ${tag}">${fmt.pct(pct)}</span></td>
    </tr>`;
  }).join('');

  const ti  = funds.reduce((s,f) => s + (f.invested??0), 0);
  const tc  = funds.reduce((s,f) => s + (f.current_value??0), 0);
  const tp  = tc - ti;
  const tpc = ti ? tp/ti*100 : 0;
  document.getElementById('mf-footer').innerHTML =
    `${funds.length} funds &nbsp;|&nbsp; Invested: ${fmt.inr(ti)} &nbsp;|&nbsp; Value: ${fmt.inr(tc)} &nbsp;|&nbsp; P&L: <span style="${tpc>=0?'color:#34d399':'color:#f87171'}">${tpc>=0?'+':''}${fmt.inr(tp)} (${fmt.pct(tpc)})</span>`;
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

  if (!fund || !amount || !date) { alert('Fund name, amount, and date are required.'); return; }

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
  if (!_mfFunds.length) { alert('Load the Mutual Funds tab first.'); return; }

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
  const link    = n.link && n.link !== '#' ? n.link : null;
  return `
    <div class="news-item">
      ${link
        ? `<a href="${link}" target="_blank" rel="noopener"
              class="text-xs font-medium text-slate-300 hover:text-white leading-relaxed block">${n.title}</a>`
        : `<p class="text-xs font-medium text-slate-400 leading-relaxed">${n.title}</p>`}
      <div class="flex items-center gap-2 mt-1.5">
        <a href="${tvUrl(ticker)}" target="_blank" rel="noopener"
           class="badge tag-neutral hover:opacity-80 transition-opacity" style="text-decoration:none">${display} ↗</a>
        <span class="text-xs text-slate-600">${n.publisher || ''} ${n.age_h ? '· ' + n.age_h + 'h ago' : ''}</span>
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
    ? mh.slice(0,8).map(h => `
        <div class="news-item">
          ${h.link ? `<a href="${h.link}" target="_blank" rel="noopener"
                         class="text-xs font-medium text-slate-300 hover:text-white leading-relaxed block">${h.title}</a>`
                   : `<p class="text-xs text-slate-400 leading-relaxed">${h.title}</p>`}
          <div class="flex items-center gap-2 mt-1">
            <span class="text-xs text-slate-600">${h.source ?? ''}</span>
            ${h.link ? `<a href="${h.link}" target="_blank" rel="noopener" class="text-xs text-indigo-400 hover:text-indigo-300 ml-auto">Read →</a>` : ''}
          </div>
        </div>`).join('')
    : '<p class="text-xs text-slate-600">No headlines yet. Add feedparser to requirements.txt</p>';

  const mn     = d.momentum_news ?? {};
  const mnKeys = Object.keys(mn);
  const wEl    = document.getElementById('news-momentum');
  wEl.innerHTML = mnKeys.length
    ? mnKeys.slice(0,12).flatMap(t => (mn[t] ?? []).slice(0,1).map(n => {
        const display = t.replace('.NS','').replace('.BO','');
        return `<div class="news-item">
          <div class="flex items-center gap-2 mb-1">
            <a href="${tvUrl(t)}" target="_blank" rel="noopener"
               class="badge hover:opacity-80 transition-opacity" style="background:rgba(99,102,241,0.15);color:#818cf8;border:1px solid rgba(99,102,241,0.3);text-decoration:none">${display} ↗</a>
          </div>
          ${n.link
            ? `<a href="${n.link}" target="_blank" rel="noopener" class="text-xs text-slate-400 hover:text-white leading-relaxed block">${n.title}</a>
               <a href="${n.link}" target="_blank" rel="noopener" class="text-xs text-indigo-400 hover:text-indigo-300 mt-1 block">Read →</a>`
            : `<p class="text-xs text-slate-500">${n.title}</p>`}
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
  if (!ticker || !qty || !price) { alert('Please fill in all required fields.'); return; }
  try {
    await saveHolding(_currentUser.uid, { ticker, qty, avg_buy_price: price, currency: cur });
    const succ = document.getElementById('add-stock-save-success');
    if (succ) { succ.classList.remove('hidden'); setTimeout(() => succ.classList.add('hidden'), 3000); }
    // Reload user portfolio to reflect the new holding
    await loadUserPortfolio(_currentUser.uid);
  } catch (e) {
    alert('Save failed: ' + e.message);
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
  if (!name || !code || !units || !nav) { alert('Please fill in all required fields.'); return; }
  try {
    await saveMutualFund(_currentUser.uid, { name, scheme_code: code, units, avg_nav: nav, sip_amount: sip, sip_date: sipd });
    const succ = document.getElementById('add-mf-save-success');
    if (succ) { succ.classList.remove('hidden'); setTimeout(() => succ.classList.add('hidden'), 3000); }
    await loadUserPortfolio(_currentUser.uid);
  } catch (e) {
    alert('Save failed: ' + e.message);
  }
}

async function removeHolding(ticker) {
  if (!_currentUser || !db) return;
  if (!confirm(`Remove ${ticker} from your portfolio?`)) return;
  try {
    await deleteHolding(_currentUser.uid, ticker);
    await loadUserPortfolio(_currentUser.uid);
  } catch (e) {
    alert('Remove failed: ' + e.message);
  }
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
  try { parsed = JSON.parse(raw); } catch(_) { alert('Invalid JSON — check for missing commas or brackets.'); return; }

  if (Array.isArray(parsed)) {
    _bulkData = { holdings: parsed, funds: [] };
  } else {
    _bulkData = {
      holdings: Array.isArray(parsed.holdings) ? parsed.holdings : [],
      funds:    Array.isArray(parsed.funds)    ? parsed.funds    : [],
    };
  }

  if (!_bulkData.holdings.length && !_bulkData.funds.length) {
    alert('No holdings or funds found in the pasted JSON.');
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
          '<span class="text-slate-200 font-mono">' + h.ticker + '</span>' +
          '<span class="text-slate-400">' + h.qty + ' &times; ' + (h.currency === 'USD' ? '$' : '₹') + h.avg_buy_price + '</span>' +
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
          '<span class="text-slate-300 truncate" style="max-width:65%">' + f.name + '</span>' +
          '<span class="text-slate-400 flex-shrink-0">' + f.units + ' units @ ₹' + f.avg_nav + '</span>' +
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
  } catch(e) {
    alert('Import failed: ' + e.message);
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
  } catch(_) { alert('Invalid JSON — please paste the raw JSON block returned by the AI.'); }
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
  } catch(_) { alert('Invalid JSON — please paste the raw JSON block returned by the AI.'); }
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
    btn.onclick = () => alert(
      'Login is not yet configured.\n\n' +
      'Edit docs/js/firebase-config.js with your Firebase project credentials\n' +
      'and set FIREBASE_CONFIGURED = true.\n\n' +
      'See the README for setup instructions.'
    );
  }
  // Hide performance auth note — show disabled state
  const perfAuthNote = document.getElementById('perf-auth-note');
  if (perfAuthNote) {
    perfAuthNote.innerHTML = '<div class="card p-6 text-center space-y-2"><div class="text-3xl">⚙️</div><div class="text-sm font-semibold text-white">Firebase Not Configured</div><div class="text-xs text-slate-400">Edit <code>docs/js/firebase-config.js</code> to enable login and performance tracking.</div></div>';
  }
}
