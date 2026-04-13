// focus-draw.js — Horizontal line drawing overlay for Focus Mode v2
// Features: place, drag, label, delete with hover icon
// Depends on bare globals `chart` and `candlestickSeries` from focus-core.js

// =========================
// STATE
// =========================
var _drawCanvas    = null;
var _drawCtx       = null;
var _drawingMode   = false;
var _drawnLines    = [];       // { id, price, y, label }
var _drawIdCounter = 0;

// Drag state
var _dragLine      = null;
var _isDragging    = false;

// Hover state
var _hoverDeleteId = null;

// Inline label input
var _labelInput    = null;
var _labelTargetId = null;

// Delete icon hit zones (populated each redraw)
var _deleteZones   = {};

// =========================
// CONSTANTS
// =========================
var HIT_THRESHOLD   = 7;
var DEL_W           = 16;
var DEL_H           = 16;
var LINE_COLOR      = 'rgba(59, 130, 246, 0.85)';
var LINE_COLOR_DRAG = 'rgba(245, 158, 11, 0.9)';
var DEL_COLOR_IDLE  = 'rgba(156, 163, 175, 0.7)';
var DEL_COLOR_HOVER = 'rgba(239, 68, 68, 0.95)';

// =========================
// BOOT
// =========================
window.addEventListener('DOMContentLoaded', function () {
    _drawCanvas = document.getElementById('overlay-canvas');
    if (!_drawCanvas) return;
    _drawCtx = _drawCanvas.getContext('2d');

    _buildLabelInput();

    var btn = document.getElementById('draw-line-btn');
    if (btn) btn.addEventListener('click', enableDrawingMode);

    _drawCanvas.addEventListener('mousedown',  _onMouseDown);
    _drawCanvas.addEventListener('mousemove',  _onMouseMove);
    _drawCanvas.addEventListener('mouseup',    _onMouseUp);
    _drawCanvas.addEventListener('mouseleave', _onMouseLeave);
    _drawCanvas.addEventListener('click',      _onClick);
    _drawCanvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    window.addEventListener('resize', resizeOverlay);
});

// =========================
// PUBLIC API
// =========================

function setupOverlayCanvas(chartInstance) {
    if (!_drawCanvas) return;
    _drawCanvas._chart = chartInstance;
    resizeOverlay();
    chartInstance.timeScale().subscribeVisibleLogicalRangeChange(function () {
        requestAnimationFrame(redrawOverlay);
    });
    chartInstance.subscribeCrosshairMove(function () {
        requestAnimationFrame(redrawOverlay);
    });
}
window.setupOverlayCanvas = setupOverlayCanvas;

function enableDrawingMode() {
    _drawingMode = true;
    _setCanvasInteractive(true);
    _drawCanvas.style.cursor = 'crosshair';
    var btn = document.getElementById('draw-line-btn');
    if (btn) btn.classList.add('active');
}
window.enableDrawingMode = enableDrawingMode;

function drawHorizontalLine(y) {
    var price = _yToPrice(y);
    if (price == null) return;
    var line = { id: ++_drawIdCounter, price: price, y: y, label: '' };
    _drawnLines.push(line);
    redrawOverlay();
    _openLabelInput(line);
}
window.drawHorizontalLine = drawHorizontalLine;

function redrawOverlay() {
    if (!_drawCtx || !_drawCanvas) return;
    _drawCtx.clearRect(0, 0, _drawCanvas.width, _drawCanvas.height);
    _deleteZones = {};

    _drawnLines.forEach(function (line) {
        var y = _priceToY(line.price);
        if (y == null) return;
        line.y = y;

        var isDraggingThis = _isDragging && _dragLine && _dragLine.id === line.id;
        var color = isDraggingThis ? LINE_COLOR_DRAG : LINE_COLOR;

        // Line
        _drawCtx.save();
        _drawCtx.setLineDash([6, 4]);
        _drawCtx.strokeStyle = color;
        _drawCtx.lineWidth   = isDraggingThis ? 2 : 1.5;
        _drawCtx.beginPath();
        _drawCtx.moveTo(0, y);
        _drawCtx.lineTo(_drawCanvas.width, y);
        _drawCtx.stroke();
        _drawCtx.restore();

        // Label pill + delete icon (right side)
        _drawCtx.save();
        _drawCtx.setLineDash([]);

        var priceStr = 'Rs.' + line.price.toFixed(2);
        var labelStr = line.label ? '  ' + line.label : '';
        var fullText = priceStr + labelStr;
        _drawCtx.font = '11px ui-sans-serif, system-ui, Arial';

        var textW  = _drawCtx.measureText(fullText).width;
        var padX   = 6;
        var bgW    = textW + padX * 2 + DEL_W + 6;
        var bgH    = 18;
        var bgX    = _drawCanvas.width - bgW - 4;
        var bgY    = y - bgH / 2;

        // Pill background
        _drawCtx.fillStyle = isDraggingThis
            ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.12)';
        _roundRect(_drawCtx, bgX, bgY, bgW, bgH, 4);
        _drawCtx.fill();

        // Text
        _drawCtx.fillStyle    = isDraggingThis ? 'rgba(245,158,11,0.95)' : color;
        _drawCtx.textBaseline = 'middle';
        _drawCtx.textAlign    = 'left';
        _drawCtx.fillText(fullText, bgX + padX, y);

        // Delete icon background
        var delX      = bgX + bgW - DEL_W - 2;
        var delY      = bgY + (bgH - DEL_H) / 2;
        var isHovered = (_hoverDeleteId === line.id);
        _drawCtx.fillStyle = isHovered ? DEL_COLOR_HOVER : DEL_COLOR_IDLE;
        _roundRect(_drawCtx, delX, delY, DEL_W, DEL_H, 3);
        _drawCtx.fill();

        // × glyph
        _drawCtx.fillStyle    = '#fff';
        _drawCtx.font         = 'bold 11px ui-sans-serif, system-ui, Arial';
        _drawCtx.textAlign    = 'center';
        _drawCtx.textBaseline = 'middle';
        _drawCtx.fillText('x', delX + DEL_W / 2, delY + DEL_H / 2);

        _deleteZones[line.id] = { x: delX, y: delY, w: DEL_W, h: DEL_H };

        _drawCtx.restore();
    });
}
window.redrawOverlay = redrawOverlay;

function clearOverlay() {
    _drawnLines    = [];
    _deleteZones   = {};
    _hoverDeleteId = null;
    _closeLabelInput();
    if (_drawCtx && _drawCanvas) {
        _drawCtx.clearRect(0, 0, _drawCanvas.width, _drawCanvas.height);
    }
}
window.clearOverlay = clearOverlay;

function resizeOverlay() {
    if (!_drawCanvas) return;
    var chartDiv = document.getElementById('chart');
    if (!chartDiv) return;
    _drawCanvas.width  = chartDiv.offsetWidth;
    _drawCanvas.height = chartDiv.offsetHeight;
    redrawOverlay();
}
window.resizeOverlay = resizeOverlay;

// =========================
// MOUSE HANDLERS
// =========================

function _onClick(e) {
    if (_drawingMode) {
        var rect = _drawCanvas.getBoundingClientRect();
        drawHorizontalLine(e.clientY - rect.top);
        _exitDrawingMode();
        return;
    }
    var rect = _drawCanvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;

    var delHit = _hitTestDelete(mx, my);
    if (delHit != null) {
        _drawnLines    = _drawnLines.filter(function (l) { return l.id !== delHit; });
        _hoverDeleteId = null;
        redrawOverlay();
        return;
    }

    var labelHit = _hitTestLabel(mx, my);
    if (labelHit != null) {
        var line = _drawnLines.find(function (l) { return l.id === labelHit; });
        if (line) _openLabelInput(line);
    }
}

function _onMouseDown(e) {
    if (_drawingMode) return;
    var rect = _drawCanvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;

    if (_hitTestDelete(mx, my) != null) return;

    var line = _nearestLine(my);
    if (line) {
        _dragLine   = line;
        _isDragging = true;
        _setCanvasInteractive(true);
        _drawCanvas.style.cursor = 'ns-resize';
        _closeLabelInput();
        e.preventDefault();
    }
}

function _onMouseMove(e) {
    var rect = _drawCanvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;

    if (_isDragging && _dragLine) {
        var newPrice = _yToPrice(my);
        if (newPrice != null) {
            _dragLine.price = newPrice;
            _dragLine.y     = my;
        }
        redrawOverlay();
        return;
    }

    var prevHover  = _hoverDeleteId;
    _hoverDeleteId = _hitTestDelete(mx, my);

    if (_hoverDeleteId != null) {
        _setCanvasInteractive(true);
        _drawCanvas.style.cursor = 'pointer';
    } else if (_nearestLine(my)) {
        _setCanvasInteractive(true);
        _drawCanvas.style.cursor = 'ns-resize';
    } else {
        _drawCanvas.style.cursor = 'default';
        if (!_drawingMode && !_isDragging) _setCanvasInteractive(false);
    }

    if (_hoverDeleteId !== prevHover) redrawOverlay();
}

function _onMouseUp() {
    if (_isDragging) {
        _isDragging = false;
        _dragLine   = null;
        _drawCanvas.style.cursor = 'default';
        redrawOverlay();
    }
}

function _onMouseLeave() {
    if (_isDragging) { _isDragging = false; _dragLine = null; redrawOverlay(); }
    if (_hoverDeleteId != null) { _hoverDeleteId = null; redrawOverlay(); }
    if (!_drawingMode) _setCanvasInteractive(false);
}

// =========================
// LABEL INPUT
// =========================

function _buildLabelInput() {
    _labelInput = document.createElement('input');
    _labelInput.type        = 'text';
    _labelInput.placeholder = 'Label line...';
    _labelInput.id          = 'draw-label-input';
    _labelInput.style.cssText = [
        'position:absolute',
        'display:none',
        'z-index:30',
        'height:24px',
        'min-width:100px',
        'max-width:160px',
        'padding:2px 8px',
        'font:12px ui-sans-serif,system-ui,Arial',
        'border:1.5px solid #3b82f6',
        'border-radius:5px',
        'background:rgba(255,255,255,0.97)',
        'color:#1e293b',
        'outline:none',
        'box-shadow:0 2px 10px rgba(59,130,246,0.25)',
    ].join(';');

    _labelInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            _closeLabelInput();
        }
    });
    _labelInput.addEventListener('blur', _closeLabelInput);

    var container = document.getElementById('chart-container');
    if (container) container.appendChild(_labelInput);
}

function _openLabelInput(line) {
    if (!_labelInput) return;
    _labelTargetId = line.id;

    var container  = document.getElementById('chart-container');
    var canvasRect = _drawCanvas ? _drawCanvas.getBoundingClientRect()     : { left: 0, top: 0 };
    var contRect   = container   ? container.getBoundingClientRect()       : { left: 0, top: 0 };

    var inputW = 120;
    var leftPx = (canvasRect.left - contRect.left) + _drawCanvas.width - inputW - DEL_W - 14;
    var topPx  = (canvasRect.top  - contRect.top)  + line.y - 36;

    _labelInput.style.left    = Math.max(0, leftPx) + 'px';
    _labelInput.style.top     = Math.max(0, topPx)  + 'px';
    _labelInput.style.display = 'block';
    _labelInput.value         = line.label || '';

    _labelInput.oninput = function () {
        var target = _drawnLines.find(function (l) { return l.id === _labelTargetId; });
        if (target) { target.label = _labelInput.value; redrawOverlay(); }
    };

    setTimeout(function () { _labelInput.focus(); _labelInput.select(); }, 0);
}

function _closeLabelInput() {
    if (!_labelInput || _labelInput.style.display === 'none') return;
    if (_labelTargetId != null) {
        var target = _drawnLines.find(function (l) { return l.id === _labelTargetId; });
        if (target) { target.label = _labelInput.value; redrawOverlay(); }
    }
    _labelInput.style.display = 'none';
    _labelInput.oninput       = null;
    _labelTargetId            = null;
}

// =========================
// HIT TESTING
// =========================

function _hitTestDelete(mx, my) {
    var found = null;
    Object.keys(_deleteZones).forEach(function (id) {
        var z = _deleteZones[id];
        if (mx >= z.x && mx <= z.x + z.w && my >= z.y && my <= z.y + z.h) {
            found = parseInt(id, 10);
        }
    });
    return found;
}

function _hitTestLabel(mx, my) {
    var found = null;
    _drawnLines.forEach(function (line) {
        if (line.y == null) return;
        var pillH = 18;
        var pillX = _drawCanvas.width - 200;
        var pillY = line.y - pillH / 2;
        if (mx >= pillX && mx <= _drawCanvas.width - DEL_W - 8 &&
            my >= pillY  && my <= pillY + pillH) {
            found = line.id;
        }
    });
    return found;
}

function _nearestLine(my) {
    var best = null; var bestD = Infinity;
    _drawnLines.forEach(function (line) {
        var d = Math.abs(line.y - my);
        if (d < bestD) { bestD = d; best = line; }
    });
    return (bestD <= HIT_THRESHOLD) ? best : null;
}

// =========================
// HELPERS
// =========================

function _setCanvasInteractive(on) {
    if (_drawCanvas) _drawCanvas.style.pointerEvents = on ? 'auto' : 'none';
}

function _exitDrawingMode() {
    _drawingMode = false;
    _setCanvasInteractive(false);
    _drawCanvas.style.cursor = 'default';
    var btn = document.getElementById('draw-line-btn');
    if (btn) btn.classList.remove('active');
}

function _getCandlestickSeries() {
    if (typeof candlestickSeries !== 'undefined' && candlestickSeries) return candlestickSeries;
    return null;
}
function _yToPrice(y) {
    var s = _getCandlestickSeries();
    if (!s) return null;
    try { return s.coordinateToPrice(y); } catch (e) { return null; }
}
function _priceToY(price) {
    var s = _getCandlestickSeries();
    if (!s) return null;
    try { return s.priceToCoordinate(price); } catch (e) { return null; }
}

function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}
