/**
 * focus-narate.js — MARKET NARRATOR ENGINE v3.0
 *
 * Personality: A calm, beginner-friendly trading teacher.
 * Simple language. Factual. No slang. No analyst jargon.
 * Explains what is happening on the chart as if teaching a class.
 *
 * Key upgrades in v3.0:
 *  - Full rewrite for "Charts Explained for Beginners" tone.
 *  - Speech Memory: avoids repeating the same phrases (last 5 tracked).
 *  - Stitch Logic: compares 50-candle history vs reveal burst to identify
 *    trend continuation, counter-trend moves, or reversals.
 *  - Pattern Sync: window.detectedPatterns is updated via getVisiblePatterns()
 *    at the top of runNarratorEngine() and getHistoryNarrationScript().
 *  - Uses volume, price mean, and 1/0 pattern flags from candle data.
 *  - Reads allCandles / revealedSoFar as bare globals from focus-core.js.
 *  - Strips rupee symbol and dashes from spoken text so the voice reads cleanly.
 */

// =============================================================================
// STATE
// =============================================================================
if (typeof narratorActive === 'undefined') var narratorActive = false;
var _speechMemory  = [];     // Stores last N phrases to prevent repetition
var _MEMORY_SIZE   = 5;
var _cachedVoices  = [];
var _pendingSpeech = null;

// =============================================================================
// VOICE INITIALISATION
// =============================================================================
function _initVoices() {
    var v = window.speechSynthesis.getVoices();
    if (v && v.length > 0) {
        _cachedVoices = v;
        if (_pendingSpeech) {
            var q = _pendingSpeech;
            _pendingSpeech = null;
            _speak(q);
        }
    }
}

if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener('voiceschanged', _initVoices);
}
_initVoices();

window.addEventListener('DOMContentLoaded', function () {
    _initVoices();
    setTimeout(_initVoices, 400);
    setTimeout(_initVoices, 1200);
});

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * toggleNarrator — called by the Narrator button in focus.html.
 * Turns narration on or off.
 */
function toggleNarrator() {
    narratorActive = !narratorActive;
    var btn = document.getElementById('narratorBtn');
    if (!btn) return;

    if (narratorActive) {
        btn.classList.add('active');
        btn.innerHTML = '<span id="narratorIcon">&#127899;&#65039;</span> Narrator On';
        _initVoices();
        _narrateHistory();
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '<span id="narratorIcon">&#128266;</span> Narrator Off';
        window.speechSynthesis.cancel();
    }
}

/**
 * runNarratorEngine — called by focus-core.js after each reveal burst.
 *
 * SYNC POINT: This is where window.detectedPatterns is updated so the narrator
 * always has the latest pattern data before building its script.
 */
function runNarratorEngine() {
    // ── SYNC: always refresh patterns before narrating ──
    if (typeof getVisiblePatterns === 'function') {
        window.detectedPatterns = getVisiblePatterns();
    }

    var history = (typeof allCandles    !== 'undefined' ? allCandles    : []);
    var burst   = (typeof revealedSoFar !== 'undefined' ? revealedSoFar : []);

    if (history.length === 0 || burst.length === 0) return;

    var burstSize   = _getRevealCount();
    var recentBurst = burst.slice(-burstSize);
    var script      = _buildRevealScript(history, burst, recentBurst);

    // Save to session report (even when narrator is off, for the written log)
    try {
        if (window.sessionReport && Array.isArray(window.sessionReport.reveals)) {
            var lastEntry = window.sessionReport.reveals[window.sessionReport.reveals.length - 1];
            if (lastEntry) {
                lastEntry.script = script;
                if (typeof window.captureSessionMoment === 'function') {
                    window.captureSessionMoment().then(function (img) { lastEntry.image = img; });
                }
            }
        }
    } catch (err) {
        console.warn('Reveal capture failed:', err);
    }

    if (narratorActive) _speak(script);
}

// =============================================================================
// HISTORY NARRATOR
// Called once when the narrator is switched on, to describe the 50-candle backdrop.
// =============================================================================

function getHistoryNarrationScript() {
    // Return cached version if it already exists for this session
    try {
        if (window.sessionReport && window.sessionReport.history && window.sessionReport.history.script) {
            return window.sessionReport.history.script;
        }
    } catch (_) {}

    var history = (typeof allCandles !== 'undefined' ? allCandles : []);
    if (history.length === 0) return '';

    // ── SYNC: refresh patterns before describing history ──
    if (typeof getVisiblePatterns === 'function') {
        window.detectedPatterns = getVisiblePatterns();
    }

    var ctx      = _buildHistoryContext(history);
    var patterns = (window.detectedPatterns || []).filter(function (p) {
        return p.indices.every(function (i) { return i < history.length; });
    });

    var parts = [
        _pick([
            'Let us start by looking at what happened before the reveal.',
            'First, here is a summary of the chart history.',
            'Before the new candles appear, let us understand the backdrop.',
            'Here is what the market was doing in the fifty candles before the reveal.',
        ]),
        _historyTrendLine(ctx),
        _historyVolumeLine(ctx),
        'The average closing price over this period was around ' + _fmtSpoken(ctx.mean) + '. This is a useful reference point as new candles are revealed.',
        patterns.length > 0
            ? _patternHistorySummary(patterns)
            : 'No clear multi-candle sequences were identified in this historical window.',
        _pick([
            'Now let us see what happens next.',
            'Keep this backdrop in mind as the new candles appear.',
            'The reveal will show us whether the market continues in the same direction or changes course.',
            'Watch how the new candles compare to what came before.',
        ]),
    ];

    var script = _clean(parts.join(' '));

    try {
        if (window.sessionReport && window.sessionReport.history && !window.sessionReport.history.script) {
            window.sessionReport.history.script = script;
        }
    } catch (_) {}

    return script;
}
window.getHistoryNarrationScript = getHistoryNarrationScript;

function _narrateHistory() {
    var script = getHistoryNarrationScript();
    if (!script) return;
    _speak(script);
    return script;
}

// =============================================================================
// REVEAL SCRIPT BUILDER
// Assembles the spoken commentary for each burst of new candles.
// =============================================================================
function _buildRevealScript(history, allRevealed, recentBurst) {
    var hCtx = _buildHistoryContext(history);
    var bCtx = _buildBurstContext(recentBurst);
    var parts = [];

    // 1. Pattern alert (highest priority — mention any newly detected patterns first)
    var newPatterns = _getSynthesisedPatterns(allRevealed, history.length);
    if (newPatterns.length > 0) parts.push(_patternAlertLine(newPatterns));

    // 2. Story stitch — how does this burst relate to the history?
    parts.push(_stitchLine(hCtx, bCtx));

    // 3. Volume — is participation rising, falling, or normal?
    parts.push(_burstVolumeLine(hCtx, bCtx));

    // 4. Price level — where are we relative to the historical average?
    parts.push(_meanPositionLine(hCtx, bCtx));

    // 5. Last candle detail — wicks, body strength, special bars
    var detail = _candleDetailLine(recentBurst);
    if (detail) parts.push(detail);

    // 6. Outlook — what does momentum say about what might come next?
    parts.push(_outlookLine(hCtx, bCtx));

    return _clean(_filterAndJoin(parts));
}

// =============================================================================
// CONTEXT BUILDERS
// Turn raw candle arrays into summary objects for the line generators.
// =============================================================================
function _buildHistoryContext(candles) {
    var n         = candles.length;
    var closes    = candles.map(function (c) { return c.close; });
    var highs     = candles.map(function (c) { return c.high; });
    var lows      = candles.map(function (c) { return c.low; });
    var volumes   = candles.map(function (c) { return c.volume || 0; });
    var mean      = closes.reduce(function (a, b) { return a + b; }, 0) / n;
    var avgVol    = volumes.reduce(function (a, b) { return a + b; }, 0) / n;
    var netChange = ((closes[n - 1] - closes[0]) / closes[0]) * 100;
    var bullCount = candles.filter(function (c) { return c.close > c.open; }).length;
    var lastCandle = candles[n - 1];
    return {
        mean       : mean,
        avgVol     : avgVol,
        netChange  : netChange,
        trendBias  : bullCount / n,            // > 0.55 = bullish, < 0.45 = bearish
        trendTag   : (lastCandle.trend_tag || 'sideways'),
        lastCandle : lastCandle,
        resistance : Math.max.apply(null, highs),
        support    : Math.min.apply(null, lows),
        bullCount  : bullCount,
        bearCount  : n - bullCount,
        n          : n,
    };
}

function _buildBurstContext(burst) {
    if (!burst || burst.length === 0) return null;
    var closes    = burst.map(function (c) { return c.close; });
    var volumes   = burst.map(function (c) { return c.volume || 0; });
    var n         = burst.length;
    var bullCount = burst.filter(function (c) { return c.close > c.open; }).length;
    var avgVol    = volumes.reduce(function (a, b) { return a + b; }, 0) / n;
    var netChange = closes.length > 1
        ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100 : 0;
    return {
        bullCount  : bullCount,
        bearCount  : n - bullCount,
        trendBias  : bullCount / n,
        avgVol     : avgVol,
        netChange  : netChange,
        n          : n,
        lastCandle : burst[n - 1],
        firstClose : closes[0],
        lastClose  : closes[closes.length - 1],
        high       : Math.max.apply(null, burst.map(function (c) { return c.high; })),
        low        : Math.min.apply(null, burst.map(function (c) { return c.low; })),
    };
}

// =============================================================================
// LINE GENERATORS — each builds one sentence or two for the spoken script.
// =============================================================================

/**
 * _historyTrendLine — describes the direction the market was moving before the reveal.
 */
function _historyTrendLine(ctx) {
    if (ctx.trendTag === 'uptrend' || ctx.netChange > 2) {
        return _pick([
            'Over the last ' + ctx.n + ' candles, the price has been moving upward. Buyers have been in control for most of this period.',
            'The historical chart shows a rising trend. Out of ' + ctx.n + ' candles, ' + ctx.bullCount + ' closed higher than they opened.',
            'Looking at the backdrop, the market was going up. The price gained about ' + ctx.netChange.toFixed(1) + ' percent over this window.',
        ]);
    }
    if (ctx.trendTag === 'downtrend' || ctx.netChange < -2) {
        return _pick([
            'Over the last ' + ctx.n + ' candles, the price has been moving downward. Sellers were in control for most of this period.',
            'The historical chart shows a falling trend. ' + ctx.bearCount + ' of the ' + ctx.n + ' candles closed lower than they opened.',
            'Looking at the backdrop, the market was going down. The price fell about ' + Math.abs(ctx.netChange).toFixed(1) + ' percent over this window.',
        ]);
    }
    return _pick([
        'Over the last ' + ctx.n + ' candles, the price moved sideways without a clear direction. Buyers and sellers were roughly balanced.',
        'The historical chart shows a ranging market. The price moved up and down but did not trend strongly in either direction.',
        'Looking at the backdrop, the market was stuck in a range. Neither buyers nor sellers took clear control.',
    ]);
}

/**
 * _historyVolumeLine — describes how much trading activity was happening in the history.
 */
function _historyVolumeLine(ctx) {
    var tag = ctx.lastCandle ? ctx.lastCandle.volume_tag : '';
    if (tag === 'volume_spike') return _pick([
        'Trading activity was above average in this period. More participants were involved, which generally means the price moves were meaningful.',
        'Volume was elevated. When a lot of people are trading, price moves tend to be more reliable.',
    ]);
    if (tag === 'volume_drop') return _pick([
        'Trading activity was below average during this period. Fewer participants were involved, which can make price moves less reliable.',
        'Volume was low in the history. Moves on light trading activity are easier to reverse.',
    ]);
    return _pick([
        'Trading activity was at a normal level during this period. Nothing unusual stands out in terms of participation.',
        'Volume was average across the historical window. The market was behaving in a typical way.',
    ]);
}

/**
 * _patternHistorySummary — summarises any multi-candle patterns found in the history.
 */
function _patternHistorySummary(patterns) {
    if (patterns.length === 1) {
        return 'The pattern engine found a ' + patterns[0].label + ' in the chart history. This is a multi-candle sequence worth noting as context.';
    }
    var labels = patterns.map(function (p) { return p.label; })
        .filter(function (v, i, a) { return a.indexOf(v) === i; });
    return 'The historical window contains ' + patterns.length + ' flagged sequences, including ' + _naturalList(labels) + '. These are patterns formed before the reveal began.';
}

/**
 * _stitchLine — THE CORE COMPARISON. Compares history direction to burst direction.
 * This is what "stitches the story" together.
 */
function _stitchLine(hCtx, bCtx) {
    if (!bCtx) return '';
    var histBull = hCtx.trendBias > 0.55;
    var histBear = hCtx.trendBias < 0.45;
    var burstBull = bCtx.trendBias > 0.55;
    var burstBear = bCtx.trendBias < 0.45;

    // History was going up, but the new candles are going down
    if (histBull && burstBear) return _pick([
        'The history showed the market going up, but these new candles are going down. This is called a counter-trend move. It could be a short pullback, or it could be the beginning of a change in direction.',
        'The backdrop was bullish, meaning buyers were in control. However, the new candles are bearish. Watch carefully, because the sellers may be starting to push back.',
        'We had an upward trend in the history, but the revealed candles are moving lower. This disagreement between history and the new price action is important. It may signal a reversal, or just a temporary pause.',
    ]);

    // History was going down, but the new candles are going up
    if (histBear && burstBull) return _pick([
        'The history showed the market going down, but these new candles are going up. This is a counter-trend bounce. It could be a brief recovery or the start of a reversal.',
        'The backdrop was bearish, meaning sellers were in control. But the new candles are bullish. Buyers are attempting to push the price higher against the previous trend.',
        'We had a downward trend in the history, but the revealed candles are moving higher. Pay attention to whether the buyers can maintain this, or whether sellers return to push the price back down.',
    ]);

    // History was going up, and so are the new candles
    if (histBull && burstBull) return _pick([
        'The history showed the market going up, and the new candles are also going up. This is called trend continuation. The buyers are still in control.',
        'The upward trend from the history is continuing into the reveal. The same buyers who were active before appear to still be present.',
        'The new candles are moving in the same direction as the history. An upward trend is continuing. This is the simplest scenario to understand.',
    ]);

    // History was going down, and so are the new candles
    if (histBear && burstBear) return _pick([
        'The history showed the market going down, and the new candles are also going down. The downward trend is continuing. Sellers remain in control.',
        'The downtrend from the history is continuing into the reveal. No sign yet of buyers stepping in to stop the decline.',
        'The new candles are moving in the same direction as the history. A downward trend is continuing. Sellers have not yet lost their grip.',
    ]);

    // Mixed or sideways in both
    return _pick([
        'The new candles are mixed, with some going up and some going down. This matches the sideways history. There is no clear direction at this point.',
        'Neither buyers nor sellers are dominating the new candles, which is consistent with the sideways backdrop. The market is still deciding.',
        'The reveal is balanced, with no strong lean in either direction. This is typical in a ranging market.',
    ]);
}

/**
 * _burstVolumeLine — describes whether trading activity increased or decreased in the burst.
 */
function _burstVolumeLine(hCtx, bCtx) {
    if (!bCtx) return '';
    var ratio = hCtx.avgVol > 0 ? bCtx.avgVol / hCtx.avgVol : 1;

    if (ratio > 1.6) return _pick([
        'Trading activity in the new candles is noticeably higher than in the history. More people are participating, which adds weight to this move.',
        'Volume has picked up in the reveal. When more traders are active during a price move, that move is generally more meaningful.',
    ]);
    if (ratio < 0.6) return _pick([
        'Trading activity in the new candles is lower than in the history. Fewer people are participating. A price move on low activity is easier to reverse.',
        'Volume has dropped in the reveal. When fewer traders are involved, the move may not have strong backing behind it.',
    ]);
    return _pick([
        'Trading activity in the reveal is roughly the same as in the history. Nothing unusual in terms of participation.',
        'Volume is normal. The market is trading at a typical level of activity for this period.',
    ]);
}

/**
 * _meanPositionLine — tells the student where price is relative to the historical average.
 */
function _meanPositionLine(hCtx, bCtx) {
    if (!bCtx) return '';
    var range = hCtx.resistance - hCtx.support;
    var pct   = range > 0 ? (bCtx.lastClose - hCtx.mean) / range : 0;

    if (pct > 0.25) return _pick([
        'The current price is above the historical average of ' + _fmtSpoken(hCtx.mean) + '. The market is trading on the higher side of its recent range.',
        'Price has moved above the average level from the history, which is ' + _fmtSpoken(hCtx.mean) + '. This is the upper part of the recent range.',
    ]);
    if (pct < -0.25) return _pick([
        'The current price is below the historical average of ' + _fmtSpoken(hCtx.mean) + '. The market is trading on the lower side of its recent range.',
        'Price has moved below the average level from the history, which is ' + _fmtSpoken(hCtx.mean) + '. This is the lower part of the recent range.',
    ]);
    return _pick([
        'The current price is close to the historical average of ' + _fmtSpoken(hCtx.mean) + '. The market is near the middle of its recent range.',
        'Price is sitting near the average level of ' + _fmtSpoken(hCtx.mean) + '. This is a neutral position within the recent range.',
    ]);
}

/**
 * _candleDetailLine — reads specific features of the most recent candle.
 * Uses the 1/0 flags and ratio fields from the candle data.
 */
function _candleDetailLine(burst) {
    if (!burst || burst.length === 0) return '';
    var last  = burst[burst.length - 1];
    var parts = [];

    // Wick analysis (uses upper_wick_ratio and lower_wick_ratio columns)
    if ((last.upper_wick_ratio || 0) > 0.6) {
        parts.push(_pick([
            'The most recent candle has a long upper shadow. This means the price tried to go higher but was pushed back down before the candle closed.',
            'There is a tall upper wick on the last candle. Sellers stepped in above the closing price and pushed it back down.',
        ]));
    } else if ((last.lower_wick_ratio || 0) > 0.6) {
        parts.push(_pick([
            'The most recent candle has a long lower shadow. This means the price fell at some point but buyers pushed it back up before the close.',
            'There is a long lower wick on the last candle. Buyers stepped in below the opening price and drove the price back up.',
        ]));
    }

    // Body strength (uses candle_strength column)
    if (last.candle_strength === 'strong' && last.close > last.open) {
        parts.push(_pick([
            'The last candle closed with a large body and no meaningful shadows. This means buyers were in control the entire time that candle was forming.',
            'A strong bullish candle to end the burst. The price opened, moved up, and closed near the top. Buyers were clearly in charge.',
        ]));
    } else if (last.candle_strength === 'strong' && last.close < last.open) {
        parts.push(_pick([
            'The last candle closed with a large body pointing downward. Sellers were in control for the whole time that candle was forming.',
            'A strong bearish candle to end the burst. The price opened, moved down, and closed near the bottom. Sellers were clearly in charge.',
        ]));
    }

    // Special bar types (uses inside_bar and outside_bar flags from data)
    if (last.inside_bar === 1) {
        parts.push(_pick([
            'The last candle is an inside bar. Its high and low both fit inside the previous candle. This means the market paused and is waiting for a reason to move.',
            'An inside bar appeared at the end of the burst. The range is smaller than the candle before it. The market is compressing, which often happens before a bigger move.',
        ]));
    }
    if (last.outside_bar === 1) {
        parts.push(_pick([
            'The last candle is an outside bar. It covers more ground than the previous candle in both directions. This shows increased activity but no clear winner yet.',
            'An outside bar closed the burst. The market expanded its range in both directions but has not picked a side. Resolution usually follows shortly after.',
        ]));
    }

    // Engulfing flags
    if (last.engulfing_soft === 1 && last.close > last.open) {
        parts.push('The last candle covered more ground than the one before it to the upside. Buyers are gaining the upper hand.');
    } else if (last.engulfing_soft === 1 && last.close < last.open) {
        parts.push('The last candle covered more ground than the one before it to the downside. Sellers are gaining the upper hand.');
    }

    return parts.join(' ');
}

/**
 * _outlookLine — uses the momentum_tag to give a simple read on what might come next.
 */
function _outlookLine(hCtx, bCtx) {
    if (!bCtx) return '';
    var mom = (bCtx.lastCandle && bCtx.lastCandle.momentum_tag) || '';

    if (mom === 'bullish_momentum') return _pick([
        'The momentum indicator is pointing upward. This means recent price gains have been building. The market may continue higher, but watch each new candle carefully.',
        'Momentum is on the side of buyers right now. This does not guarantee the price will keep rising, but it means the trend has been gaining strength.',
    ]);
    if (mom === 'bearish_momentum') return _pick([
        'The momentum indicator is pointing downward. This means recent price declines have been building. The market may continue lower.',
        'Momentum is on the side of sellers right now. The price has been losing ground consistently, which can encourage further selling.',
    ]);
    return _pick([
        'Momentum is neutral at the moment. It is not clearly on the side of buyers or sellers. The next few candles will be important for figuring out where the market is headed.',
        'The momentum reading is balanced. There is no strong push in either direction right now. This is a good time to observe rather than assume.',
        'Momentum is sitting in the middle. Neither buyers nor sellers have a clear edge based on recent price movement.',
    ]);
}

/**
 * _patternAlertLine — announces newly detected patterns from the reveal burst.
 * These are prioritised in the script because they are live, newly-formed signals.
 */
function _patternAlertLine(patterns) {
    if (patterns.length === 1) {
        return _pick([
            'The pattern engine has just identified a ' + patterns[0].label + ' in the new candles. This is a freshly formed sequence. It was not present in the history.',
            'A new pattern has appeared. The reveal candles have formed a ' + patterns[0].label + '. This is a live signal to pay attention to.',
        ]);
    }
    var labels = patterns.map(function (p) { return p.label; });
    return 'Multiple patterns have appeared in the new candles: ' + _naturalList(labels) + '. When several patterns form at the same time, it adds weight to the overall picture.';
}

// =============================================================================
// PATTERN HELPERS
// =============================================================================

/**
 * _getSynthesisedPatterns — returns only patterns that include at least one
 * candle from the reveal (index >= historyLength), meaning they are newly formed.
 */
function _getSynthesisedPatterns(allRevealed, historyLength) {
    return (window.detectedPatterns || []).filter(function (p) {
        return p.indices.some(function (i) { return i >= historyLength; });
    });
}

// =============================================================================
// SPEECH MEMORY
// Prevents the narrator from saying the same or very similar phrases twice.
// =============================================================================

function _filterAndJoin(phrases) {
    var valid    = phrases.filter(function (p) { return p && p.trim().length > 0; });
    var filtered = valid.filter(function (phrase) {
        var tokens = _tokenise(phrase);
        return !_speechMemory.some(function (mem) {
            return _similarity(tokens, _tokenise(mem)) > 0.65;
        });
    });
    // If everything was filtered out (very unlikely), fall back to unfiltered
    var toSpeak = filtered.length > 0 ? filtered : valid;
    toSpeak.forEach(function (phrase) {
        _speechMemory.push(phrase);
        if (_speechMemory.length > _MEMORY_SIZE) _speechMemory.shift();
    });
    return toSpeak.join(' ').trim();
}

function _tokenise(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
}

function _similarity(tokensA, tokensB) {
    if (!tokensA.length || !tokensB.length) return 0;
    var setA = {}, setB = {};
    tokensA.forEach(function (t) { setA[t] = true; });
    tokensB.forEach(function (t) { setB[t] = true; });
    var keysA  = Object.keys(setA);
    var keysB  = Object.keys(setB);
    var common = keysA.filter(function (t) { return setB[t]; }).length;
    return common / Math.max(keysA.length, keysB.length);
}

// =============================================================================
// SPEECH ENGINE
// =============================================================================
function _speak(text) {
    if (!text || text.trim() === '') return;
    if (_cachedVoices.length === 0) {
        _pendingSpeech = text;
        _initVoices();
        return;
    }
    window.speechSynthesis.cancel();
    var msg   = new SpeechSynthesisUtterance(text);
    msg.rate  = 1.0;   // Slightly slower than v2 — teacher pace
    msg.pitch = 0.90;
    var preferred =
        _cachedVoices.find(function (v) {
            return v.lang.startsWith('en') && (
                v.name.includes('Google')   ||
                v.name.includes('Natural')  ||
                v.name.includes('Premium')  ||
                v.name.includes('Enhanced')
            );
        }) ||
        _cachedVoices.find(function (v) { return v.lang.startsWith('en-GB'); }) ||
        _cachedVoices.find(function (v) { return v.lang.startsWith('en'); });
    if (preferred) msg.voice = preferred;
    window.speechSynthesis.speak(msg);
}

// =============================================================================
// UTILITY
// =============================================================================

/** Pick a random item from an array — ensures variety across narrations. */
function _pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/** Format a price number cleanly for speech (no rupee symbol). */
function _fmtSpoken(price) {
    return (+price).toFixed(2);
}

/** Strip characters that cause text-to-speech issues. */
function _clean(text) {
    return (text || '')
        .replace(/[\u20B9]/g, '')   // remove rupee sign
        .replace(/\u2014/g, ', ')   // em dash → pause
        .replace(/\u2013/g, ', ')   // en dash → pause
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/** Format a list of items naturally: "a, b, and c". */
function _naturalList(items) {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return items[0] + ' and ' + items[1];
    return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

/** Read the reveal count selector to know how many candles form the current burst. */
function _getRevealCount() {
    var el  = document.getElementById('revealCount') || document.getElementById('revealCountSelect');
    if (!el) return 4;
    var val = parseInt(el.value);
    return isNaN(val) || val < 1 ? 4 : val;
}
