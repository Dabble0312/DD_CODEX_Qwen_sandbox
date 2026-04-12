// focus-ui.js — Focus Mode UI layer
// Handles all DOM updates: HUD, stats panel, button states, candle info panel,
// price feedback, summary panel toggle, and end screen.
// Depends on: focus-summary.js (for summarize()).
// Load BEFORE focus-core.js.

/* -----------------------------------------
   BUTTON STATES
   Three states:
   "reveal"    — Reveal active, UP/DOWN dimmed
   "revealing" — all buttons inactive (mid-reveal)
   "guess"     — UP/DOWN active, Reveal dimmed
----------------------------------------- */
function setButtonState(state) {
    const revealBtn  = document.getElementById('revealBtn');
    const upBtn      = document.getElementById('upBtn');
    const downBtn    = document.getElementById('downBtn');
    const priceInput = document.getElementById('priceTarget');

    if (!revealBtn || !upBtn || !downBtn) return;

    const dim   = el => { el.disabled = true;  el.classList.add('btn-dim'); };
    const light = el => { el.disabled = false; el.classList.remove('btn-dim'); };

    if (state === "reveal") {
        light(revealBtn); dim(upBtn); dim(downBtn);
        if (priceInput) { priceInput.disabled = true;  priceInput.classList.add('btn-dim'); }
    } else if (state === "revealing") {
        dim(revealBtn); dim(upBtn); dim(downBtn);
        if (priceInput) { priceInput.disabled = true;  priceInput.classList.add('btn-dim'); }
    } else if (state === "guess") {
        dim(revealBtn); light(upBtn); light(downBtn);
        if (priceInput) {
            priceInput.disabled = false;
            priceInput.classList.remove('btn-dim');
            priceInput.focus();
        }
    }
}

/* -----------------------------------------
   HUD + STATUS LINE
----------------------------------------- */
function updateHUD() {
    const el = document.getElementById('focusHUD');
    if (el) {
        el.innerHTML =
            `Correct: <strong>${correctCount}</strong> &nbsp;|&nbsp; ` +
            `Wrong: <strong>${wrongCount} / ${MAX_WRONG}</strong> &nbsp;|&nbsp; ` +
            `Revealed: <strong>${revealIndex} / ${futureCandles.length}</strong>`;
    }
}

function showStatus(msg) {
    const el = document.getElementById('focusStatus');
    if (el) el.textContent = msg;
}

/* -----------------------------------------
   STATS PANEL
   Shows technical tags of the most recently
   seen (or clicked) candle.
----------------------------------------- */
function updateStatsPanel(candle) {
    const last = candle !== undefined
        ? candle
        : (revealedSoFar.length > 0
            ? revealedSoFar[revealedSoFar.length - 1]
            : allCandles[allCandles.length - 1]);

    if (!last) return;

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = (val !== null && val !== undefined) ? val : '—';
    };

    set('statTrend',      last.trend_tag      ? last.trend_tag.replace(/_/g, ' ')      : '—');
    set('statMomentum',   last.momentum_tag   ? last.momentum_tag.replace(/_/g, ' ')   : '—');
    set('statVolatility', last.volatility_tag ? last.volatility_tag.replace(/_/g, ' ') : '—');
    set('statRSI',        last.rsi            ? last.rsi.toFixed(1)                     : '—');
    set('statATR',        last.atr            ? last.atr.toFixed(2)                     : '—');
    set('statVolume',     last.volume_tag     ? last.volume_tag.replace(/_/g, ' ')      : '—');
    set('statStrength',   last.candle_strength ? last.candle_strength                   : '—');
}

/* -----------------------------------------
   CANDLE INFO PANEL
   Shows OHLC of the clicked candle.
   Pass null to reset (on new block load).
----------------------------------------- */
function showCandleInfo(candle) {
    const el = document.getElementById('candleInfo');
    if (!el) return;

    if (!candle) {
        el.innerHTML = '<span class="candle-info-empty">Click any candle to inspect</span>';
        return;
    }

    const dir      = candle.bullish === 1 ? '▲' : '▼';
    const dirColor = candle.bullish === 1 ? '#10b981' : '#ef4444';

    el.innerHTML =
        `<span class="candle-info-date">${candle.date.slice(0, 10)}</span>` +
        `<span class="candle-info-dir" style="color:${dirColor}">${dir}</span>` +
        `<span class="candle-info-item"><span class="candle-info-label">O</span>₹${candle.open.toFixed(2)}</span>` +
        `<span class="candle-info-item"><span class="candle-info-label">H</span>₹${candle.high.toFixed(2)}</span>` +
        `<span class="candle-info-item"><span class="candle-info-label">L</span>₹${candle.low.toFixed(2)}</span>` +
        `<span class="candle-info-item"><span class="candle-info-label">C</span><strong>₹${candle.close.toFixed(2)}</strong></span>`;
}

/* -----------------------------------------
   PRICE FEEDBACK PANEL
   Stays visible until next prediction fires.
----------------------------------------- */
function showPriceFeedback(msg) {
    const el = document.getElementById('priceFeedback');
    if (el) el.textContent = msg;
}

/* -----------------------------------------
   SUMMARY PANEL TOGGLE
   Shown/hidden by clicking the info button.
   Auto-refreshes if a new candle is clicked
   while the panel is open.
----------------------------------------- */
function toggleSummary() {
    const panel = document.getElementById('summaryPanel');
    if (!panel) return;

    if (panel.classList.contains('hidden')) {
        const candle = revealedSoFar.length > 0
            ? revealedSoFar[revealedSoFar.length - 1]
            : allCandles[allCandles.length - 1];
        if (!candle) return;
        const text = document.getElementById('summaryText');
        if (text) text.textContent = summarize(candle);  // focus-summary.js
        panel.classList.remove('hidden');
    } else {
        panel.classList.add('hidden');
    }
}

function refreshSummaryIfOpen(candle) {
    const panel = document.getElementById('summaryPanel');
    if (!panel || panel.classList.contains('hidden')) return;
    const text = document.getElementById('summaryText');
    if (text && candle) text.textContent = summarize(candle);
}

/* -----------------------------------------
   LOADING INDICATOR
   Shown while Supabase fetch is in flight.
----------------------------------------- */
function showChartLoading() {
    const chartDiv = document.getElementById('chart');
    if (chartDiv) chartDiv.innerHTML =
        '<div class="chart-loading"><div class="spinner"></div>Loading chart…</div>';
}
