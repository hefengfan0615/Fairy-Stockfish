// Mini Xiangqi (迷你象棋) WASM Engine Worker
// Uses Fairy-Stockfish UCI engine via stockfish-web.js for real analysis
// Engine initialization pattern references stockfish.js (https://github.com/nmrugg/stockfish.js)
//
// Design: this worker is disposable — the main thread terminates and recreates it
// on every board change. The engine runs "go infinite" so it never sends bestmove.

let engine = null;
let engineReady = false;

// Load the engine module
async function loadEngine() {
    try {
        // Dynamically import the engine module
        // Use stockfish-web.js (recompiled with USE_PTHREADS=1 and EXPORTED_FUNCTIONS
        // including _command and _isReady) which matches the stockfish-web.wasm binary.
        const module = await import('./stockfish-web.js');
        const StockfishEngine = module.default;

        // Set up output handlers BEFORE module initialization
        // (this is the pattern used by stockfish.js - nmrugg)
        const moduleArgs = {
            // Explicitly locate WASM and worker files relative to this worker's URL.
            // USE_ES6_IMPORT_META=0 can't auto-resolve paths in Worker context.
            locateFile: (path) => {
                return new URL('./' + path, import.meta.url).href;
            },
            print: (line) => {
                // Only forward info lines; go infinite never produces bestmove
                if (line.startsWith('info depth')) {
                    const data = parseInfoLine(line);
                    if (data) {
                        self.postMessage({
                            type: 'analysis',
                            data: data
                        });
                    }
                }
            },
            printErr: (line) => {
                console.error('[engine]', line);
            }
        };

        engine = await StockfishEngine(moduleArgs);

        // Wait for engine to be ready
        await waitForReady();
        engineReady = true;

        // Initialize engine for minixiangqi
        sendCommand('uci');
        // Wait a bit for UCI to initialize, then set variant and options
        await sleep(200);
        sendCommand('setoption name UCI_Variant value minixiangqi');
        sendCommand('setoption name Use NNUE value true');
        sendCommand('setoption name EvalFile value minixiangqi.nnue');
        sendCommand('isready');

        self.postMessage({ type: 'ready' });
    } catch (err) {
        console.error('Engine initialization error:', err);
        self.postMessage({ type: 'error', data: 'Failed to initialize engine: ' + err.message });
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForReady() {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 200; // 10 seconds
        function check() {
            attempts++;
            if (engine && engine._isReady && engine._isReady()) {
                resolve();
            } else if (attempts >= maxAttempts) {
                reject(new Error('Engine initialization timed out'));
            } else {
                setTimeout(check, 50);
            }
        }
        check();
    });
}

function sendCommand(cmd) {
    if (!engine) return;
    try {
        engine.ccall('command', null, ['string'], [cmd]);
    } catch (err) {
        console.error('Error sending command:', cmd, err);
    }
}

function parseInfoLine(line) {
    const parts = line.split(' ');
    let depth = '', seldepth = '', score = '', scoreType = '', nodes = '', nps = '', time = '', pv = '';

    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === 'depth' && i + 1 < parts.length) depth = parts[++i];
        else if (parts[i] === 'seldepth' && i + 1 < parts.length) seldepth = parts[++i];
        else if (parts[i] === 'score' && i + 2 < parts.length) {
            scoreType = parts[++i];
            score = parts[++i];
        }
        else if (parts[i] === 'nodes' && i + 1 < parts.length) nodes = parts[++i];
        else if (parts[i] === 'nps' && i + 1 < parts.length) nps = parts[++i];
        else if (parts[i] === 'time' && i + 1 < parts.length) time = parts[++i];
        else if (parts[i] === 'pv') {
            pv = parts.slice(i + 1).join(' ');
            break;
        }
    }

    return { depth, seldepth, score, scoreType, nodes, nps, time, pv, rawLine: line };
}

function doSearch(fen, moves) {
    if (!engine || !engineReady) return;

    // Set up position using the FEN from the main thread
    const movesStr = moves && moves.length > 0 ? ' moves ' + moves.join(' ') : '';
    sendCommand('position fen ' + fen + movesStr);

    // Start infinite search — never produces bestmove, just info lines
    sendCommand('go infinite');
}

// Handle messages from main thread
self.onmessage = function (e) {
    const { type, data } = e.data;

    switch (type) {
        case 'init':
            loadEngine();
            break;

        case 'start':
            if (!engine || !engineReady) return;
            const { fen, moves } = data;
            doSearch(fen, moves);
            break;

        default:
            break;
    }
};