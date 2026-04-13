// focus-core.js — Focus Mode core: state, data loading, game logic, chart setup, boot.
// This is the orchestrator — all other focus-*.js files provide helper functions
// that this file calls. Load this file LAST in focus.html.
//
// Load order in focus.html:
//   shared/chart.js → shared/ui.js → focus-summary.js → focus-patterns.js → focus-ui.js → focus-core.js

// =========================
// CONFIGURATION
// =========================
const MAX_REVEALS_PER_BURST = 7;
const MAX_WRONG             = 5;
const REVEAL_SPEED_MS       = 600;

function getRevealCount() {
    const el  = document.getElementById('revealCount');
    if (!el) return 4;
    const val = parseInt(el.value);
    if (isNaN(val) || val < 1) return 1;
    if (val > MAX_REVEALS_PER_BURST) return MAX_REVEALS_PER_BURST;
    return val;
}

// =========================
// STATE
// =========================
let allCandles    = [];
let futureCandles = [];
let revealIndex   = 0;
let revealedSoFar = [];

let correctCount  = 0;
let wrongCount    = 0;
let guessCount    = 0;

let awaitingGuess    = false;
let autoRevealActive = false;
let sessionActive    = false;

let pendingPrediction = null;

let chart;
let candlestickSeries;
let volumeSeries;

let detectedPatterns = [];

let username = localStorage.getItem("username") || "Player";

// =========================
// SESSION REPORT (Flight Data Recorder)
// =========================
let sessionReport = null;

function initSessionReport() {
    sessionReport = {
        timestamp: new Date().toISOString(),
        history: { image: null, script: null },
        reveals: [],
        prediction: {
            guess: null,       // 'up' | 'down'
            target: null,      // User's price target
            actualPrice: null, // Final closing price (last candle close)
            isCorrect: false,
            accuracyDelta: null,
        },
    };
    window.sessionReport = sessionReport;
}

function captureSessionMoment() {
    return new Promise((resolve) => {
        if (typeof chart === 'undefined' || !chart || typeof chart.takeScreenshot !== 'function') {
            resolve(null);
            return;
        }

        requestAnimationFrame(() => {
            setTimeout(() => {
                try {
                    const canvas  = chart.takeScreenshot();
                    const dataUrl = canvas.toDataURL('image/png');
                    resolve(dataUrl);
                } catch (err) {
                    console.warn('captureSessionMoment failed:', err);
                    resolve(null);
                }
            }, 40);
        });
    });
}
window.captureSessionMoment = captureSessionMoment;

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function openSessionReport() {
    if (!window.finalSessionReport) {
        // Fallback: if session ended but finalSessionReport wasn't set yet, build it now
        buildFinalSessionReport();
    }
    if (!window.finalSessionReport) {
        alert('No session report found yet.');
        return;
    }

    const r       = window.finalSessionReport;
    const reveals = Array.isArray(r.reveals) ? r.reveals : [];

    // ── Only scored bursts (entries that have a user prediction attached)
    const bursts = reveals.filter(rev => rev && rev.userTargetPrice != null);

    const totalBursts = bursts.length;
    const correct     = bursts.filter(b => b.isCorrect).length;
    const accuracy    = totalBursts > 0 ? Math.round((correct / totalBursts) * 100) : 0;

    // ── History commentary
    const historyScript = (r.history && r.history.script) || null;

    // ── Per-burst cards
    const burstCardsHtml = bursts.map((burst, idx) => {
        const burstNum    = idx + 1;
        const target      = burst.userTargetPrice != null ? (+burst.userTargetPrice).toFixed(2) : '—';
        const actual      = burst.actualPrice      != null ? (+burst.actualPrice).toFixed(2)      : '—';
        const delta       = burst.delta            != null ? (+burst.delta).toFixed(2)             : '—';
        const isCorrect   = burst.isCorrect;
        const direction   = burst.userDirection || '—';

        const deltaNum    = burst.delta != null ? +burst.delta : null;
        const deltaSign   = deltaNum != null ? (deltaNum >= 0 ? '+' : '') : '';
        const deltaClass  = deltaNum == null ? '' : (deltaNum >= 0 ? 'positive' : 'negative');
        const resultClass = isCorrect ? 'correct' : 'wrong';
        const resultLabel = isCorrect ? '✓ Correct' : '✗ Incorrect';

        const screenshot  = burst.image
            ? `<img class="burst-shot" src="${burst.image}" />`
            : `<div class="shot-missing">No screenshot captured for this burst.</div>`;

        const commentary  = burst.script
            ? `<div class="commentary">${escapeHtml(burst.script)}</div>`
            : `<div class="commentary muted">No market commentary was captured for this burst.</div>`;

        const cog = burst.cognitiveStatements;
        const cogBlock = cog ? `
            <div class="burst-cognitive">
                <div class="burst-cog-card">
                    <div class="burst-cog-title">Bias</div>
                    <div class="burst-cog-text">${escapeHtml(cog.biasSummary)}</div>
                </div>
                <div class="burst-cog-card">
                    <div class="burst-cog-title">Calibration</div>
                    <div class="burst-cog-text">${escapeHtml(cog.calibrationSummary)}</div>
                </div>
            </div>` : '';

        return `
        <section class="burst-card">
            <div class="burst-header">
                <span class="burst-label">Burst ${burstNum}</span>
                <span class="result-badge ${resultClass}">${resultLabel}</span>
            </div>
            ${screenshot}
            ${commentary}
            <div class="price-row">
                <div class="price-cell">
                    <div class="price-label">Your Target</div>
                    <div class="price-value">₹${target}</div>
                </div>
                <div class="price-cell">
                    <div class="price-label">Actual Close</div>
                    <div class="price-value">₹${actual}</div>
                </div>
                <div class="price-cell">
                    <div class="price-label">Delta</div>
                    <div class="price-value ${deltaClass}">${deltaSign}${delta}</div>
                </div>
                <div class="price-cell">
                    <div class="price-label">Trend Called</div>
                    <div class="price-value trend-${direction}">${direction.toUpperCase()}</div>
                </div>
            </div>
            ${cogBlock}
        </section>`;
    }).join('\n');

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DojiDash — Session Report</title>
  <style>
    :root {
      --bg: #0b0f19; --surface: #111827; --border: #1f2937;
      --text: #e5e7eb; --muted: #6b7280; --accent: #3b82f6;
      --green: #10b981; --red: #ef4444; --yellow: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; padding: 32px 24px; }
    .wrap { max-width: 820px; margin: 0 auto; }

    /* ── Header */
    .report-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; gap: 16px; flex-wrap: wrap; }
    .report-title { font-size: 22px; font-weight: 700; letter-spacing: -0.3px; }
    .report-meta { color: var(--muted); font-size: 12px; margin-top: 4px; }
    .header-actions { display: flex; gap: 8px; }
    .btn { border: 1px solid var(--border); background: #0f172a; color: var(--text); padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; }
    .btn:hover { background: #1e293b; }

    /* ── Summary bar */
    .summary-bar { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 28px; }
    .summary-cell { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; text-align: center; }
    .summary-num { font-size: 28px; font-weight: 700; line-height: 1; }
    .summary-lbl { font-size: 12px; color: var(--muted); margin-top: 4px; }
    .summary-num.green { color: var(--green); }
    .summary-num.red   { color: var(--red); }
    .summary-num.blue  { color: var(--accent); }

    /* ── History section */
    .section-title { font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 12px; }
    .history-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px; margin-bottom: 28px; }
    .history-text { font-size: 14px; line-height: 1.7; color: var(--text); }

    /* ── Cognitive analysis — per burst */
    .burst-cognitive { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
    .burst-cog-card { background: rgba(59,130,246,0.06); border: 1px solid rgba(59,130,246,0.18); border-radius: 8px; padding: 12px 14px; }
    .burst-cog-title { font-size: 10px; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 0.7px; margin-bottom: 6px; }
    .burst-cog-text { font-size: 13px; line-height: 1.65; color: #cbd5e1; }
    @media (max-width: 520px) { .burst-cognitive { grid-template-columns: 1fr; } }
    @media print { .burst-cog-card { background: #f0f4ff; border-color: #bfcfef; } .burst-cog-text { color: #1e293b; } }

    /* ── Burst screenshot */
    .burst-shot { width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--border); background: #0b1222; display: block; margin-bottom: 14px; }
    .shot-missing { padding: 12px; border-radius: 8px; border: 1px dashed var(--border); color: var(--muted); font-size: 12px; font-style: italic; margin-bottom: 14px; }

    /* ── Burst cards */
    .bursts-grid { display: grid; gap: 16px; }
    .burst-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px; }
    .burst-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
    .burst-label { font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .result-badge { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 20px; }
    .result-badge.correct { background: rgba(16,185,129,0.15); color: var(--green); border: 1px solid rgba(16,185,129,0.3); }
    .result-badge.wrong   { background: rgba(239,68,68,0.12);  color: var(--red);   border: 1px solid rgba(239,68,68,0.25); }

    .commentary { font-size: 14px; line-height: 1.75; color: #cbd5e1; margin-bottom: 16px; padding: 14px; background: rgba(15,23,42,0.6); border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0; }
    .commentary.muted { color: var(--muted); border-left-color: var(--border); font-style: italic; }

    .price-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .price-cell { background: rgba(15,23,42,0.5); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; text-align: center; }
    .price-label { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
    .price-value { font-size: 15px; font-weight: 600; }
    .price-value.positive { color: var(--green); }
    .price-value.negative { color: var(--red); }
    .price-value.trend-up   { color: var(--green); }
    .price-value.trend-down { color: var(--red); }

    @media (max-width: 520px) {
      .price-row { grid-template-columns: repeat(2, 1fr); }
      .summary-bar { grid-template-columns: repeat(3, 1fr); }
    }
    @media print {
      body { background: #fff; color: #000; }
      .burst-card, .history-card, .summary-cell { border: 1px solid #ddd; background: #fff; }
      .burst-shot { border-color: #ddd; background: #fff; }
      .commentary { background: #f8fafc; border-left-color: #3b82f6; color: #1e293b; }
      .price-cell { background: #f8fafc; border-color: #ddd; }
      .btn { display: none; }
    }
  </style>
</head>
<body>
<div class="wrap">

  <div class="report-header">
    <div>
      <div class="report-title">DojiDash — Session Report</div>
      <div class="report-meta">${escapeHtml(r.timestamp || '')} &nbsp;·&nbsp; ${totalBursts} burst${totalBursts !== 1 ? 's' : ''} analysed</div>
    </div>
    <div class="header-actions">
      <button class="btn" onclick="window.print()">Print / PDF</button>
      <button class="btn" onclick="downloadJson()">Download JSON</button>
    </div>
  </div>

  <div class="summary-bar">
    <div class="summary-cell">
      <div class="summary-num blue">${totalBursts}</div>
      <div class="summary-lbl">Bursts Played</div>
    </div>
    <div class="summary-cell">
      <div class="summary-num green">${correct}</div>
      <div class="summary-lbl">Correct Calls</div>
    </div>
    <div class="summary-cell">
      <div class="summary-num ${accuracy >= 60 ? 'green' : accuracy >= 40 ? 'blue' : 'red'}">${accuracy}%</div>
      <div class="summary-lbl">Accuracy</div>
    </div>
  </div>

  ${historyScript ? `
  <div class="section-title">Market backdrop</div>
  <div class="history-card">
    <div class="history-text">${escapeHtml(historyScript)}</div>
  </div>` : ''}

  <div class="section-title">Reveal bursts</div>
  <div class="bursts-grid">
    ${burstCardsHtml || '<div class="history-card"><div class="history-text" style="color:var(--muted)">No scored bursts recorded.</div></div>'}
  </div>

</div>
<script>
  const report = ${JSON.stringify(r)};
  function downloadJson() {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'session-report.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
</script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
}
window.openSessionReport = openSessionReport;


/* -----------------------------------------
   1. LOAD BLOCK FROM SUPABASE
----------------------------------------- */
async function loadFocusBlock() {
    showChartLoading();      // focus-ui.js
    showStatus("Loading chart...");

    try {
        const { data, error } = await supabaseClient
            .from('focus_blocks')
            .select('id, block_id, candles, future, window_start, detected_patterns')
            .order('id')
            .limit(500);

        if (error) throw error;

        if (!data || data.length === 0) {
            showStatus("No blocks available.");
            return;
        }

        const block = data[Math.floor(Math.random() * data.length)];

        if (!block.candles || !block.future) {
            console.error('Block missing candles or future:', block);
            return;
        }

        allCandles       = block.candles;
        futureCandles    = block.future;
        detectedPatterns = block.detected_patterns || [];
        revealIndex      = 0;
        revealedSoFar    = [];

        initChart();
        initSessionReport();
        resetSession();
        updateStatsPanel();     // focus-ui.js
        showCandleInfo(null);   // focus-ui.js
        showPriceFeedback("");  // focus-ui.js
        showStatus("");
        clearPatternHighlights();  // focus-patterns.js
        hidePatternPanels();       // focus-patterns.js
        clearDynamicZones();       // focus-patterns.js

        // Capture the initial 50-candle "History" moment (image + script) for the Session Report.
        try {
            const historyScript = (typeof window.getHistoryNarrationScript === 'function')
                ? window.getHistoryNarrationScript()
                : null;
            const historyImage = await captureSessionMoment();
            if (sessionReport) sessionReport.history = { image: historyImage, script: historyScript };
        } catch (err) {
            console.warn('History capture failed:', err);
        }

    } catch (err) {
        console.error("Supabase Error:", err.message);
        showStatus("Failed to load block.");
    }
}

/* -----------------------------------------
   2. CHART SETUP
   Uses shared constants from shared/chart.js.
----------------------------------------- */
function initChart() {
    const chartDiv = document.getElementById('chart');
    if (chart) chart.remove();
    chartDiv.innerHTML = '';

    chart = window.LightweightCharts.createChart(chartDiv, {
        height: 501,
        layout: {
            textColor:       '#000',
            backgroundColor: '#fff',
        },
        timeScale: {
            timeVisible:    true,
            secondsVisible: false,
            rightOffset:    4,
        },
        rightPriceScale: {
            scaleMargins: { top: 0.05, bottom: 0.25 },
        },
        crosshair: {
            mode: 0,   // 0 = Normal (free crosshair, not snapping)
        },
    });

    candlestickSeries = chart.addCandlestickSeries(CANDLESTICK_SERIES_OPTIONS);
    volumeSeries      = chart.addHistogramSeries(VOLUME_SERIES_OPTIONS);
    chart.priceScale('volume').applyOptions(VOLUME_PRICE_SCALE_OPTIONS);

    renderChart();

    // Focus mode lets the y-axis autoscale to visible candles only
    candlestickSeries.applyOptions({ autoscaleInfoProvider: undefined });

    chart.timeScale().fitContent();
    updateDynamicZones();   // focus-patterns.js — draws initial zones

    // ── Candle click → update stats + info panel
    chart.subscribeClick((param) => {
        if (!param || !param.time) return;
        const clickedDate = param.time;
        const allVisible  = [...allCandles, ...revealedSoFar];
        const matched     = allVisible.find(c => c.date.slice(0, 10) === clickedDate);
        if (!matched) return;

        updateStatsPanel(matched);   // focus-ui.js
        showCandleInfo(matched);     // focus-ui.js
        refreshSummaryIfOpen(matched); // focus-ui.js
    });

    // ── Redraw zone overlays on viewport change
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        requestAnimationFrame(drawZoneOverlays);   // focus-patterns.js
    });
    chart.subscribeCrosshairMove(() => {
        requestAnimationFrame(drawZoneOverlays);
    });

    setupZoneCanvas(chartDiv);   // focus-patterns.js
}

/* -----------------------------------------
   3. RENDER CHART
----------------------------------------- */
function renderChart() {
    const all        = [...allCandles, ...revealedSoFar];
    candlestickSeries.setData(all.map(toCandlePoint));   // shared/chart.js
    volumeSeries.setData(all.map(toVolumePoint));        // shared/chart.js
}

/* -----------------------------------------
   4. SESSION STATE
----------------------------------------- */
function resetSession() {
    correctCount     = 0;
    wrongCount       = 0;
    guessCount       = 0;
    awaitingGuess    = false;
    autoRevealActive = false;
    sessionActive    = true;

    pendingPrediction = null;
    if (!sessionReport) initSessionReport();
    updateHUD();             // focus-ui.js
    setButtonState("reveal"); // focus-ui.js
}

/* -----------------------------------------
   5. REVEAL LOGIC
----------------------------------------- */
function startAutoReveal() {
    // When awaiting a guess, REVEAL submits the target price instead of revealing candles
    if (awaitingGuess) { handleGuess(); return; }
    if (!sessionActive || autoRevealActive) return;
    if (revealIndex >= futureCandles.length) {
        endSession("complete");
        return;
    }

    autoRevealActive = true;
    setButtonState("revealing");

    let count = 0;
    const maxThisBurst = getRevealCount();

    function revealNext() {
        if (count >= maxThisBurst || revealIndex >= futureCandles.length) {
            autoRevealActive = false;
            awaitingGuess    = true;
            setButtonState("guess");
            showStatus("What happens next?");

            // --- Trigger narrator engine (captures script even if muted) ---
            if (typeof runNarratorEngine === 'function') {
                runNarratorEngine();
            }
            // ----------------------------------------------------------------

            return;
        }

        const candle    = futureCandles[revealIndex];
        const thisIndex = revealIndex;
        revealedSoFar.push(candle);
        revealIndex++;
        count++;

        renderChart();
       
        updateStatsPanel();      // focus-ui.js
        updateDynamicZones();    // focus-patterns.js

        if (pendingPrediction && pendingPrediction.candleIndex === thisIndex) {
            scorePendingPrediction();
        } else {
            // Capture chart snapshot for non-scoring reveals (continuation candles in a burst)
            if (sessionReport && Array.isArray(sessionReport.reveals)) {
                // Check if an entry for this candle already exists
                let revealEntry = sessionReport.reveals.find(function(r) { 
                    return r.candleIndex === thisIndex; 
                });
                
                if (!revealEntry) {
                    revealEntry = {
                        candleIndex:     thisIndex,
                        step:            sessionReport.reveals.length + 1,
                        userDirection:   null,
                        userTargetPrice: null,
                        actualPrice:     candle.close,
                        delta:           null,
                        isCorrect:       null,
                        image:           null,
                        script:          null,
                    };
                    sessionReport.reveals.push(revealEntry);
                }
                
                if (typeof window.captureSessionMoment === 'function') {
                    window.captureSessionMoment().then(function (img) { revealEntry.image = img; });
                }
            }
        }

        setTimeout(revealNext, REVEAL_SPEED_MS);
    }

    revealNext();
}

/* -----------------------------------------
   6. GUESS LOGIC
----------------------------------------- */
function handleGuess(guess) {
    if (!sessionActive || !awaitingGuess) return;

    if (!futureCandles[revealIndex]) {
        endSession("complete");
        return;
    }

    const priceInput  = document.getElementById('priceTarget');
    const targetValue = priceInput ? parseFloat(priceInput.value) : NaN;

    const baselineClose = revealedSoFar.length > 0
        ? revealedSoFar[revealedSoFar.length - 1].close
        : allCandles[allCandles.length - 1].close;

    // ── Validate target price — required input
    if (isNaN(targetValue) || targetValue <= 0) {
        showStatus("Enter a target price before revealing.");
        return;   // keep awaitingGuess = true
    }

    // ── Derive direction from target vs current close
    const derivedDirection = targetValue > baselineClose ? 'up' : 'down';
    guess = derivedDirection;

    awaitingGuess = false;
    if (priceInput) priceInput.value = '';

    const finalClose = futureCandles.length > 0
        ? futureCandles[futureCandles.length - 1].close
        : baselineClose;
    const hasTarget = true;   // already validated above

    if (!sessionReport) initSessionReport();
    if (sessionReport) {
        sessionReport.prediction.guess         = derivedDirection;
        sessionReport.prediction.target        = targetValue;
        sessionReport.prediction.actualPrice   = finalClose;
        sessionReport.prediction.isCorrect     = (derivedDirection === 'up' && finalClose > baselineClose) || (derivedDirection === 'down' && !(finalClose > baselineClose));
        sessionReport.prediction.accuracyDelta = Math.abs(targetValue - finalClose);
        console.log('[SessionReport]', sessionReport);
    }

    const burstEndIndex = Math.min(
        revealIndex + getRevealCount() - 1,
        futureCandles.length - 1
    );

    pendingPrediction = {
        guess,
        targetPrice:  targetValue,
        candleIndex:  burstEndIndex,
        baseClose:    baselineClose,
    };

    // Expose for focus-narate.js so the narrator attaches the script to the right burst entry
    window._pendingBurstEndIndex = burstEndIndex;

    showStatus("Revealing…");
    setButtonState("reveal");

    // Single press: prediction is locked — immediately start the reveal burst
    startAutoReveal();
}

/* -----------------------------------------
   6b. SCORE PENDING PREDICTION
----------------------------------------- */
function scorePendingPrediction() {
    if (!pendingPrediction) return;

    const { guess, targetPrice, candleIndex, baseClose } = pendingPrediction;
    pendingPrediction = null;
    guessCount++;

    const predictedCandle = futureCandles[candleIndex];
    const priceWentUp     = predictedCandle.close > baseClose;
    const correct         = (guess === 'up' && priceWentUp) || (guess === 'down' && !priceWentUp);

    // ── Capture decision to session report (per reveal)
    if (sessionReport && Array.isArray(sessionReport.reveals)) {
        const actualPrice = predictedCandle.close;
        const delta       = actualPrice - targetPrice;   // targetPrice always present now
        
        // Find the reveal entry for this candleIndex, or create a new one
        let revealEntry = sessionReport.reveals.find(function(r) { 
            return r.candleIndex === candleIndex; 
        });
        
        if (!revealEntry) {
            revealEntry = {
                candleIndex:     candleIndex,
                step:            sessionReport.reveals.length + 1,
                userDirection:   guess,
                userTargetPrice: targetPrice,
                actualPrice:     actualPrice,
                delta:           delta,
                isCorrect:       correct,
                image:           null,
                script:          null,
            };
            sessionReport.reveals.push(revealEntry);
        } else {
            revealEntry.userDirection   = guess;
            revealEntry.userTargetPrice = targetPrice;
            revealEntry.actualPrice     = actualPrice;
            revealEntry.delta           = delta;
            revealEntry.isCorrect       = correct;
        }
        
        if (typeof window.captureSessionMoment === 'function') {
            window.captureSessionMoment().then(function (img) { revealEntry.image = img; });
        }
    }

    if (correct) {
        correctCount++;
        showPopup("correct");    // shared/ui.js
        showWSBPopup(true);      // shared/ui.js
    } else {
        wrongCount++;
        showPopup("wrong");
        showWSBPopup(false);
    }

    // ── Price target feedback (targetPrice always present)
    {
        const actual  = predictedCandle.close;
        const diff    = actual - targetPrice;
        const diffPct = ((Math.abs(diff) / actual) * 100).toFixed(1);
        let msg;
        if (Math.abs(diff) / actual < 0.005)
            msg = `🎯 Spot on! Target ₹${targetPrice.toFixed(2)} vs actual ₹${actual.toFixed(2)}`;
        else if (diff > 0)
            msg = `📈 Actual was ${diffPct}% higher than your target (₹${targetPrice.toFixed(2)} → ₹${actual.toFixed(2)})`;
        else
            msg = `📉 Actual was ${diffPct}% lower than your target (₹${targetPrice.toFixed(2)} → ₹${actual.toFixed(2)})`;
        showPriceFeedback(msg);   // focus-ui.js
    }

    updateHUD();    // focus-ui.js

    if (wrongCount >= MAX_WRONG) {
        setTimeout(() => endSession("focus_lost"), 1400);
        return;
    }
    if (revealIndex >= futureCandles.length) {
        setTimeout(() => endSession("complete"), 1400);
        return;
    }

    setTimeout(() => { showStatus(""); }, 2000);
}

/* -----------------------------------------
   6c. BUILD FINAL SESSION REPORT
   Silent. No popup. No download.
   Computes cognitiveSnapshot + cognitiveStatements,
   attaches them to sessionReport, and stores the
   complete object in window.finalSessionReport.
   Called automatically at the top of endSession().
----------------------------------------- */
function buildFinalSessionReport() {
    if (!sessionReport) return;

    const reveals = Array.isArray(sessionReport.reveals) ? sessionReport.reveals : [];
    const bursts  = reveals.filter(b => b && b.userTargetPrice != null && b.actualPrice != null && b.delta != null);

    if (bursts.length === 0) {
        sessionReport.cognitiveSnapshot   = null;
        sessionReport.cognitiveStatements = null;
        window.finalSessionReport = JSON.parse(JSON.stringify(sessionReport));
        return;
    }

    // ── Helper: compute cognitive fields for a single burst
    function burstCognition(b) {
        const targetPrice = +b.userTargetPrice;
        const actualPrice = +b.actualPrice;
        const delta       = +b.delta;
        const pctDev      = Math.abs(delta) / actualPrice * 100;

        // directionalExpectation — derived from userDirection (which encodes target vs baseClose)
        const directionalExpectation = b.userDirection === 'up' ? 'Positive' : 'Negative';

        // optimismPessimism — target vs actual (delta = actual - target, so delta<0 → target was above actual = Optimistic)
        const optimismPessimism = delta < 0 ? 'Optimistic' : delta > 0 ? 'Pessimistic' : 'Neutral';

        // overshootUndershoot — pct deviation of this single target
        let overshootUndershoot;
        if      (pctDev < 1) overshootUndershoot = 'Accurate';
        else if (pctDev < 3) overshootUndershoot = 'Mild Overshoot/Undershoot';
        else if (pctDev < 7) overshootUndershoot = 'Moderate Overshoot/Undershoot';
        else                  overshootUndershoot = 'Strong Overshoot/Undershoot';

        // magnitudeCalibration — abs(delta) as % of actualPrice for this burst
        const absDeltaPct = pctDev;
        let magnitudeCalibration;
        if      (absDeltaPct < 2) magnitudeCalibration = 'Tight';
        else if (absDeltaPct < 5) magnitudeCalibration = 'Moderate';
        else                       magnitudeCalibration = 'Loose';

        // directionalCalibration — sign of delta for this burst
        const directionalCalibration = delta < 0 ? 'Aimed Too High' : delta > 0 ? 'Aimed Too Low' : 'Aligned';

        // systematicBias — for a single burst this mirrors directionalCalibration
        const systematicBias = delta < 0 ? 'Consistent Overshooter' : delta > 0 ? 'Consistent Undershooter' : 'Balanced';

        return {
            snapshot: { directionalExpectation, optimismPessimism, overshootUndershoot, magnitudeCalibration, directionalCalibration, systematicBias },
            statements: {
                biasSummary:
                    `The target reflected a ${directionalExpectation} expectation for the move. ` +
                    `The target was overall ${optimismPessimism} relative to the actual outcome. ` +
                    `The target showed a ${overshootUndershoot} tendency based on percentage deviation.`,
                calibrationSummary:
                    `Calibration was ${magnitudeCalibration}, based on the distance from actual price. ` +
                    `Directionally, the target tended to be ${directionalCalibration}. ` +
                    `For this burst, the pattern was ${systematicBias}.`,
            },
        };
    }

    // ── Attach per-burst cognitive data directly onto each reveal entry
    bursts.forEach(b => {
        const cog = burstCognition(b);
        b.cognitiveSnapshot   = cog.snapshot;
        b.cognitiveStatements = cog.statements;
    });

    // ── Session-level aggregates (kept in cognitiveSnapshot for JSON completeness)
    const totalAbsDelta  = bursts.reduce((s, b) => s + Math.abs(b.delta), 0);
    const totalActual    = bursts.reduce((s, b) => s + b.actualPrice, 0);
    const sumDelta       = bursts.reduce((s, b) => s + b.delta, 0);
    const avgAbsDelta    = totalAbsDelta / bursts.length;
    const avgActual      = totalActual   / bursts.length;
    const meanDelta      = sumDelta      / bursts.length;
    const avgAbsDeltaPct = (avgAbsDelta  / avgActual)  * 100;

    const positiveCount = bursts.filter(b => b.userDirection === 'up').length;
    const directionalExpectation = positiveCount >= (bursts.length - positiveCount) ? 'Positive' : 'Negative';
    const optimisticCount  = bursts.filter(b => b.delta < 0).length;
    const pessimisticCount = bursts.length - optimisticCount;
    const optimismPessimism = optimisticCount === pessimisticCount ? 'Neutral' : optimisticCount > pessimisticCount ? 'Optimistic' : 'Pessimistic';
    const avgPctDev = bursts.reduce((s, b) => s + (Math.abs(b.delta) / b.actualPrice * 100), 0) / bursts.length;
    const overshootUndershoot = avgPctDev < 1 ? 'Accurate' : avgPctDev < 3 ? 'Mild Overshoot/Undershoot' : avgPctDev < 7 ? 'Moderate Overshoot/Undershoot' : 'Strong Overshoot/Undershoot';
    const magnitudeCalibration = avgAbsDeltaPct < 2 ? 'Tight' : avgAbsDeltaPct < 5 ? 'Moderate' : 'Loose';
    const directionalCalibration = meanDelta < 0 ? 'Aimed Too High' : meanDelta > 0 ? 'Aimed Too Low' : 'Aligned';
    const systematicBias = meanDelta < 0 ? 'Consistent Overshooter' : meanDelta > 0 ? 'Consistent Undershooter' : 'Balanced';

    sessionReport.cognitiveSnapshot = { directionalExpectation, optimismPessimism, overshootUndershoot, magnitudeCalibration, directionalCalibration, systematicBias };
    sessionReport.cognitiveStatements = null; // statements now live per-burst

    // ── STORE as single source of truth
    window.finalSessionReport = JSON.parse(JSON.stringify(sessionReport));
}
window.buildFinalSessionReport = buildFinalSessionReport;

/* -----------------------------------------
   7. END SESSION
----------------------------------------- */
function endSession(reason) {
    // ── Freeze and enrich the report before any UI changes
    buildFinalSessionReport();

    sessionActive    = false;
    autoRevealActive = false;
    awaitingGuess    = false;
    setButtonState("revealing");

    // Reveal all remaining candles at once
    revealedSoFar = [...futureCandles];
    renderChart();

    const accuracy = guessCount > 0
        ? Math.round((correctCount / guessCount) * 100)
        : 0;

    const title = reason === "focus_lost" ? "Focus Lost — Reset Needed" : "Session Complete";

    const endScreen  = document.getElementById('endScreen');
    const resultText = endScreen ? endScreen.querySelector('p') : null;

    if (endScreen && resultText) {
        resultText.innerHTML =
            `<strong>${title}</strong><br><br>` +
            `Guesses: <strong>${guessCount}</strong><br>` +
            `Correct: <strong>${correctCount}</strong><br>` +
            `Wrong: <strong>${wrongCount}</strong><br>` +
            `Accuracy: <strong>${accuracy}%</strong><br>` +
            `Candles revealed: <strong>${revealIndex} / ${futureCandles.length}</strong>`;
        endScreen.classList.remove('hidden');
    }

    document.getElementById('playAgainBtn').onclick = () => {
        endScreen.classList.add('hidden');
        loadFocusBlock();
    };
    document.getElementById('homeBtn').onclick = () => {
        window.location.href = 'index.html';
    };

    const reportBtn = document.getElementById('reportBtn');
    if (reportBtn) reportBtn.onclick = () => openSessionReport();
}

/* -----------------------------------------
   8. KEYBOARD SHORTCUTS
   (Up/Down direction is now derived from target price — no key shortcuts needed)
----------------------------------------- */

/* -----------------------------------------
   9. BOOT
----------------------------------------- */
window.addEventListener('DOMContentLoaded', () => {
    const display = document.getElementById('usernameDisplay');
    if (display) display.textContent = 'Player: ' + username;

    // ── Bind button listeners
    const el = id => document.getElementById(id);
    if (el('narratorBtn'))             el('narratorBtn').addEventListener('click', toggleNarrator);
    if (el('revealBtn'))               el('revealBtn').addEventListener('click', startAutoReveal);
    if (el('togglePatternsBtn'))       el('togglePatternsBtn').addEventListener('click', togglePatterns);
    if (el('togglePatternExplainBtn')) el('togglePatternExplainBtn').addEventListener('click', togglePatternExplain);
    if (el('summaryToggleBtn'))        el('summaryToggleBtn').addEventListener('click', toggleSummary);

    loadFocusBlock();
});
