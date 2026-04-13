// focus-draw.js — Horizontal line drawing overlay for Focus Mode
// Depends on: focus-core.js (exposes `chart` as a global after initChart runs)
// Load order in focus.html: ... focus-draw.js → focus-core.js

// =========================
// STATE
// =========================
var _drawCanvas     = null;   // <canvas id="overlay-canvas">
var _drawCtx        = null;   // 2d context
var _drawingMode    = false;  // true while user is placing a line
var _drawnLines     = [];     // [{ id, price, y }]  — y is last-known pixel position
var _drawIdCounter  = 0;

// =========================
// BOOT — wire up after DOM ready
// =========================
window.addEventListener('DOMContentLoaded', function () {
    _drawCanvas = document.getElementById('overlay-canvas');
    if (!_drawCanvas) return;
    _drawCtx = _drawCanvas.getContext('2d');

    // Draw button toggle
    var btn = document.getElementById('draw-line-btn');
    if (btn) btn.addEventListener('click', enableDrawingMode);

    // Click on canvas → place line
    _drawCanvas.addEventListener('click', function (e) {
        if (!_drawingMode) return;
        var rect = _drawCanvas.getBoundingClientRect();
        var y    = e.clientY - rect.top;
        drawHorizontalLine(y);
        _exitDrawingMode();
    });

    // Right-click on canvas → remove nearest line
    _drawCanvas.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        var rect = _drawCanvas.getBoundingClientRect();
        var y    = e.clientY - rect.top;
        _removeNearestLine(y);
    });

    // Resize handling
    window.addEventListener('resize', resizeOverlay);
});

// Called by focus-core.js initChart() after the LightweightCharts instance is ready.
// Pass the chart instance so pixel↔price mapping is available.
function setupOverlayCanvas(chartInstance) {
    if (!_drawCanvas) return;
    // Store reference so redraw can use coordinateToPrice
    _drawCanvas._chart = chartInstance;

    resizeOverlay();

    // Re-map stored line prices back to pixel Y whenever the chart redraws
    chartInstance.timeScale().subscribeVisibleLogicalRangeChange(function () {
        requestAnimationFrame(redrawOverlay);
    });
    chartInstance.subscribeCrosshairMove(function () {
        // lightweight-charts doesn't expose a dedicated priceScale onChange,
        // so we piggyback on crosshairMove to catch zoom/pan rescales.
        requestAnimationFrame(redrawOverlay);
    });
}
window.setupOverlayCanvas = setupOverlayCanvas;

// =========================
// PUBLIC API
// =========================

function enableDrawingMode() {
    _drawingMode = true;
    if (_drawCanvas) {
        _drawCanvas.style.pointerEvents = 'auto';
        _drawCanvas.style.cursor        = 'crosshair';
    }
    var btn = document.getElementById('draw-line-btn');
    if (btn) btn.classList.add('active');
}
window.enableDrawingMode = enableDrawingMode;

// Place a horizontal line at pixel Y, convert to price and store.
function drawHorizontalLine(y) {
    var price = _yToPrice(y);
    if (price == null) return;

    _drawnLines.push({ id: ++_drawIdCounter, price: price, y: y });
    redrawOverlay();
}
window.drawHorizontalLine = drawHorizontalLine;

function redrawOverlay() {
    if (!_drawCtx || !_drawCanvas) return;
    _drawCtx.clearRect(0, 0, _drawCanvas.width, _drawCanvas.height);

    _drawnLines.forEach(function (line) {
        // Re-map stored price → current pixel Y (handles zoom / pan)
        var y = _priceToY(line.price);
        if (y == null) return;
        line.y = y;   // keep in sync for hit-testing

        _drawCtx.save();
        _drawCtx.setLineDash([6, 4]);
        _drawCtx.strokeStyle = 'rgba(59, 130, 246, 0.85)';   // --accent blue
        _drawCtx.lineWidth   = 1.5;
        _drawCtx.beginPath();
        _drawCtx.moveTo(0, y);
        _drawCtx.lineTo(_drawCanvas.width, y);
        _drawCtx.stroke();

        // Price label on the right edge
        _drawCtx.setLineDash([]);
        _drawCtx.fillStyle    = 'rgba(59, 130, 246, 0.9)';
        _drawCtx.font         = '11px ui-sans-serif, system-ui, Arial';
        _drawCtx.textAlign    = 'right';
        _drawCtx.textBaseline = 'middle';
        _drawCtx.fillText('₹' + line.price.toFixed(2), _drawCanvas.width - 6, y - 8);
        _drawCtx.restore();
    });
}
window.redrawOverlay = redrawOverlay;

function clearOverlay() {
    _drawnLines = [];
    if (_drawCtx && _drawCanvas) {
        _drawCtx.clearRect(0, 0, _drawCanvas.width, _drawCanvas.height);
    }
}
window.clearOverlay = clearOverlay;

function resizeOverlay() {
    if (!_drawCanvas) return;
    var container = document.getElementById('chart-container');
    if (!container) return;
    var chartDiv  = document.getElementById('chart');
    if (!chartDiv) return;

    // Match the canvas pixel dimensions to the chart div
    _drawCanvas.width  = chartDiv.offsetWidth;
    _drawCanvas.height = chartDiv.offsetHeight;

    redrawOverlay();
}
window.resizeOverlay = resizeOverlay;

// =========================
// PIXEL ↔ PRICE HELPERS
// =========================

function _getChartInstance() {
    // focus-core.js stores the instance as the bare global `chart`
    // Also attached to canvas by setupOverlayCanvas for safety
    if (_drawCanvas && _drawCanvas._chart) return _drawCanvas._chart;
    if (typeof chart !== 'undefined' && chart) return chart;
    return null;
}

function _getCandlestickSeries() {
    // focus-core.js exposes the series as bare global `candlestickSeries`
    if (typeof candlestickSeries !== 'undefined' && candlestickSeries) return candlestickSeries;
    return null;
}

// Convert pixel Y on the canvas → price via LightweightCharts API
function _yToPrice(y) {
    var series = _getCandlestickSeries();
    if (!series) return null;
    try {
        return series.coordinateToPrice(y);
    } catch (e) {
        return null;
    }
}

// Convert price → pixel Y on the canvas
function _priceToY(price) {
    var series = _getCandlestickSeries();
    if (!series) return null;
    try {
        return series.priceToCoordinate(price);
    } catch (e) {
        return null;
    }
}

// =========================
// PRIVATE HELPERS
// =========================

function _exitDrawingMode() {
    _drawingMode = false;
    if (_drawCanvas) {
        _drawCanvas.style.pointerEvents = 'none';
        _drawCanvas.style.cursor        = 'default';
    }
    var btn = document.getElementById('draw-line-btn');
    if (btn) btn.classList.remove('active');
}

// Remove the line whose stored Y is closest to the click Y (within 8px threshold)
function _removeNearestLine(clickY) {
    var threshold = 8;
    var closest   = null;
    var closestD  = Infinity;

    _drawnLines.forEach(function (line) {
        var d = Math.abs(line.y - clickY);
        if (d < closestD) { closestD = d; closest = line; }
    });

    if (closest && closestD <= threshold) {
        _drawnLines = _drawnLines.filter(function (l) { return l.id !== closest.id; });
        redrawOverlay();
    }
}
