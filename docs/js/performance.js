// ── PERFORMANCE TRACKING ──────────────────────────────────────────────────────
let _perfChart        = null;
let _perfSnapshots    = [];
let _perfPeriodDays   = 30;

async function loadPerformanceTab() {
  if (!_currentUser || !db) return;
  await switchPerfPeriod(_perfPeriodDays);
}

async function switchPerfPeriod(days) {
  _perfPeriodDays = days;
  if (!_currentUser || !db) return;

  document.querySelectorAll('.perf-period-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.days) === days);
  });

  const loadingEl = document.getElementById('perf-loading');
  if (loadingEl) loadingEl.classList.remove('hidden');

  try {
    const endDate   = todayStr();
    const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
    _perfSnapshots  = await getSnapshots(_currentUser.uid, startDate, endDate);
    renderPerformanceChart(_perfSnapshots);
    renderChangeCards(_perfSnapshots);
  } catch (e) {
    console.error('Performance data load error:', e);
  } finally {
    if (loadingEl) loadingEl.classList.add('hidden');
  }
}

function renderPerformanceChart(snapshots) {
  const ctx = document.getElementById('perf-chart')?.getContext('2d');
  if (!ctx) return;

  const emptyEl = document.getElementById('perf-chart-empty');
  if (!snapshots.length) {
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (_perfChart) { _perfChart.destroy(); _perfChart = null; }
    return;
  }
  if (emptyEl) emptyEl.classList.add('hidden');

  const labels = snapshots.map(s => {
    const d = new Date(s.date + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  });
  const data = snapshots.map(s => s.total_current ?? 0);

  if (_perfChart) _perfChart.destroy();
  _perfChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor:      '#6366f1',
        backgroundColor:  'rgba(99,102,241,0.1)',
        borderWidth:      2,
        pointRadius:      snapshots.length <= 30 ? 3 : 1,
        pointHoverRadius: 5,
        fill:             true,
        tension:          0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ' ₹' + Number(ctx.raw).toLocaleString('en-IN', { maximumFractionDigits: 0 }),
          },
          backgroundColor: '#1e293b', titleColor: '#94a3b8', bodyColor: '#e2e8f0',
          borderColor: '#334155', borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748b', font: { size: 10 }, maxTicksLimit: 10 },
          grid:  { color: '#1e293b' },
        },
        y: {
          ticks: {
            color: '#64748b', font: { size: 10 },
            callback: v => '₹' + Number(v).toLocaleString('en-IN', { notation: 'compact', maximumFractionDigits: 1 }),
          },
          grid: { color: '#334155' },
        },
      },
    },
  });
}

function renderChangeCards(snapshots) {
  const CARDS = ['perf-daily', 'perf-weekly', 'perf-monthly'];
  if (!snapshots.length) {
    CARDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<span class="text-slate-600 text-sm">No data yet</span>';
    });
    return;
  }

  const today    = snapshots[snapshots.length - 1];
  const todayVal = today.total_current ?? 0;

  function change(past) {
    if (!past) return null;
    const prev = past.total_current ?? 0;
    const diff = todayVal - prev;
    const pct  = prev > 0 ? (diff / prev * 100) : 0;
    return { abs: diff, pct };
  }

  function daysAgoDate(d) {
    const dt = new Date(today.date + 'T00:00:00');
    dt.setDate(dt.getDate() - d);
    return dt.toISOString().split('T')[0];
  }

  function findBefore(cutoff) {
    for (let i = snapshots.length - 2; i >= 0; i--) {
      if (snapshots[i].date <= cutoff) return snapshots[i];
    }
    return null;
  }

  function renderCard(id, c) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!c) { el.innerHTML = '<span class="text-slate-600 text-xs">Not enough data</span>'; return; }
    const col  = c.abs >= 0 ? '#34d399' : '#f87171';
    const sign = c.abs >= 0 ? '+' : '';
    el.innerHTML = `
      <div class="stat-value text-2xl" style="color:${col}">${sign}₹${Math.abs(c.abs).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
      <div class="stat-sub" style="color:${col}">${sign}${c.pct.toFixed(2)}%</div>`;
  }

  renderCard('perf-daily',   change(findBefore(daysAgoDate(1))));
  renderCard('perf-weekly',  change(findBefore(daysAgoDate(7))));
  renderCard('perf-monthly', change(findBefore(daysAgoDate(30))));
}

function _buildSnapshotData(holdings, mfFunds, priceMap, navMap) {
  const portfolioView = computePortfolioView(holdings, priceMap);
  const mfView        = computeMFView(mfFunds, navMap);
  const totalInvested = portfolioView.reduce((s, h) => s + (h.invested      ?? 0), 0)
                      + mfView.reduce(       (s, f) => s + (f.invested      ?? 0), 0);
  const totalCurrent  = portfolioView.reduce((s, h) => s + (h.current_value ?? 0), 0)
                      + mfView.reduce(       (s, f) => s + (f.current_value ?? 0), 0);
  return { portfolioView, mfView, totalInvested, totalCurrent };
}

async function maybeCreateDailySnapshot(uid, holdings, mfFunds, priceMap, navMap) {
  if (!uid || !db) return;
  const today = todayStr();
  try {
    const { totalInvested, totalCurrent, portfolioView, mfView } =
      _buildSnapshotData(holdings, mfFunds, priceMap, navMap);

    // Skip if prices haven't loaded yet
    if (totalCurrent === 0) return;

    const existing = await db.collection('users').doc(uid)
      .collection('snapshots').doc(today).get();

    // Skip only if a valid (non-zero) snapshot already exists
    if (existing.exists && (existing.data().total_current ?? 0) > 0) return;

    await saveSnapshot(uid, today, {
      timestamp:      firebase.firestore.FieldValue.serverTimestamp(),
      total_invested: totalInvested,
      total_current:  totalCurrent,
      total_pnl:      totalCurrent - totalInvested,
      total_pnl_pct:  totalInvested > 0 ? ((totalCurrent - totalInvested) / totalInvested * 100) : 0,
      stock_count:    portfolioView.length,
      mf_count:       mfView.length,
    });
  } catch (e) {
    console.warn('Daily snapshot creation failed (non-fatal):', e);
  }
}

async function recalculateTodaySnapshot(uid, holdings, mfFunds, priceMap, navMap) {
  if (!uid || !db) return;
  const today = todayStr();
  const { totalInvested, totalCurrent, portfolioView, mfView } =
    _buildSnapshotData(holdings, mfFunds, priceMap, navMap);

  if (totalCurrent === 0) {
    alert('Prices not loaded yet — please wait a moment and try again.');
    return;
  }

  await saveSnapshot(uid, today, {
    timestamp:      firebase.firestore.FieldValue.serverTimestamp(),
    total_invested: totalInvested,
    total_current:  totalCurrent,
    total_pnl:      totalCurrent - totalInvested,
    total_pnl_pct:  totalInvested > 0 ? ((totalCurrent - totalInvested) / totalInvested * 100) : 0,
    stock_count:    portfolioView.length,
    mf_count:       mfView.length,
  });

  await loadPerformanceTab();
}
