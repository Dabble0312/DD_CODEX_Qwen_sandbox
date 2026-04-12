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
    if (!window.sessionReport) {
        alert('No session report found yet.');
        return;
    }

    const r = window.sessionReport;
    const reveals = Array.isArray(r.reveals) ? r.reveals : [];
    const pred = r.prediction || {};

    const historyImg = r.history && r.history.image ? `<img class="shot" src="${r.history.image}" />` : `<div class="missing">No screenshot captured.</div>`;
    const historyScript = r.history && r.history.script ? escapeHtml(r.history.script) : '(no script captured)';

    const revealHtml = reveals.map((rev, idx) => {
        const img = rev && rev.image ? `<img class="shot" src="${rev.image}" />` : `<div class="missing">Screenshot pending / missing.</div>`;
        const script = escapeHtml((rev && rev.script) || '');
        const step = (rev && (rev.step || rev.step === 0)) ? rev.step : (idx + 1);
        const direction = rev && rev.userDirection ? escapeHtml(rev.userDirection) : '';
        const target = rev && rev.userTargetPrice != null ? escapeHtml(rev.userTargetPrice) : '';
        const actual = rev && rev.actualPrice != null ? escapeHtml(rev.actualPrice) : '';
        const delta = rev && rev.delta != null ? escapeHtml(rev.delta) : '';
        const correct = rev && rev.isCorrect != null ? (rev.isCorrect ? 'Yes' : 'No') : '';
        
        const guessInfo = direction || target || actual 
            ? `<div class="guess-info">
                <div class="kv"><span class="k">Direction</span><span class="v">${direction}</span></div>
                ${target ? `<div class="kv"><span class="k">Target</span><span class="v">${target}</span></div>` : ''}
                ${actual ? `<div class="kv"><span class="k">Actual</span><span class="v">${actual}</span></div>` : ''}
                ${delta ? `<div class="kv"><span class="k">Delta</span><span class="v">${delta}</span></div>` : ''}
                ${correct ? `<div class="kv"><span class="k">Correct</span><span class="v">${correct}</span></div>` : ''}
               </div>` 
            : '';
        
        return `
            <section class="card">
                <h3>Reveal Burst ${escapeHtml(step)}</h3>
                ${img}
                ${guessInfo}
                <pre class="script">${script || '(no script captured)'}</pre>
            </section>
        `;
    }).join('\n');

    const predBlock = `
        <section class="card">
            <h3>Prediction</h3>
            <div class="kv"><span class="k">Guess</span><span class="v">${escapeHtml(pred.guess || '')}</span></div>
            <div class="kv"><span class="k">Target</span><span class="v">${pred.target == null ? '' : escapeHtml(pred.target)}</span></div>
            <div class="kv"><span class="k">Final Close</span><span class="v">${pred.actualPrice == null ? '' : escapeHtml(pred.actualPrice)}</span></div>
            <div class="kv"><span class="k">Correct</span><span class="v">${escapeHtml(String(!!pred.isCorrect))}</span></div>
            <div class="kv"><span class="k">Accuracy Delta</span><span class="v">${pred.accuracyDelta == null ? '' : escapeHtml(pred.accuracyDelta)}</span></div>
        </section>
    `;

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Session Report</title>
    <style>
      :root { --bg:#0b0f19; --card:#111827; --text:#e5e7eb; --muted:#9ca3af; --line:#1f2937; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 24px; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
      .wrap { max-width: 980px; margin: 0 auto; }
      header { display:flex; gap:12px; align-items:baseline; justify-content:space-between; margin-bottom: 16px; }
      h1 { font-size: 20px; margin: 0; }
      .meta { color: var(--muted); font-size: 12px; }
      .actions { display:flex; gap:8px; }
      button { border:1px solid var(--line); background:#0f172a; color:var(--text); padding:8px 10px; border-radius:10px; cursor:pointer; }
      button:hover { background:#111c33; }
      .grid { display:grid; gap:12px; }
      .card { background: var(--card); border:1px solid var(--line); border-radius:14px; padding:14px; }
      h2 { font-size: 16px; margin: 0 0 8px; }
      h3 { font-size: 14px; margin: 0 0 8px; color: var(--text); }
      .shot { width: 100%; height: auto; border-radius: 10px; border:1px solid var(--line); background:#0b1222; }
      .missing { padding: 12px; border-radius: 10px; border:1px dashed var(--line); color: var(--muted); }
      .script { white-space: pre-wrap; margin: 10px 0 0; padding: 10px; border-radius: 10px; border:1px solid var(--line); background:#0f172a; color: var(--text); font-size: 12px; line-height: 1.5; }
      .guess-info { margin: 10px 0; padding: 10px; border-radius: 10px; border:1px solid var(--line); background:#0f172a; }
      .kv { display:flex; justify-content:space-between; gap:12px; padding: 6px 0; border-bottom: 1px solid rgba(31,41,55,0.7); }
      .kv:last-child { border-bottom: none; }
      .k { color: var(--muted); }
      @media print {
        body { background: #fff; color: #000; padding: 0; }
        .card { border:1px solid #ddd; background:#fff; }
        .script { background:#f7f7f7; border:1px solid #ddd; color:#000; }
        button { display:none; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <header>
        <div>
          <h1>Session Report</h1>
          <div class="meta">Timestamp: ${escapeHtml(r.timestamp || '')} • Reveals: ${reveals.length}</div>
        </div>
        <div class="actions">
          <button onclick="window.print()">Print / Save PDF</button>
          <button onclick="downloadJson()">Download JSON</button>
        </div>
      </header>

      <div class="grid">
        <section class="card">
          <h2>History (Initial 50 Candles)</h2>
          ${historyImg}
          <pre class="script">${historyScript}</pre>
        </section>

        ${predBlock}

        <section class="card">
          <h2>Reveal Bursts</h2>
          <div class="grid">
            ${revealHtml || '<div class="missing">No reveal bursts recorded.</div>'}
          </div>
        </section>
      </div>
    </div>

    <script>
      const report = ${JSON.stringify(r)};
      function downloadJson() {
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'session-report.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    </script>
  </body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
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
    if (!sessionActive || autoRevealActive || awaitingGuess) return;
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

    showStatus("Reveal to see if you were right!");
    setButtonState("reveal");
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
   7. END SESSION
----------------------------------------- */
function endSession(reason) {
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
