// Mini Xiangqi (迷你象棋) WASM Engine Worker
// Uses Fairy-Stockfish UCI engine via stockfish-web.js for real analysis

let engine = null;
let engineReady = false;
let isSearching = false;
let lastInfoData = null;
let pendingSearch = null;

// Load the engine module
async function loadEngine() {
    try {
        // Dynamically import the engine module
        const module = await import('./stockfish-web.js');
        const StockfishEngine = module.default;
        engine = await StockfishEngine();

        engine.print = (line) => {
            if (line.startsWith('info depth')) {
                const data = parseInfoLine(line);
                if (data) {
                    lastInfoData = data;
                    self.postMessage({
                        type: 'analysis',
                        data: data
                    });
                }
            } else if (line.startsWith('bestmove')) {
                isSearching = false;
                if (lastInfoData) {
                    self.postMessage({
                        type: 'analysis',
                        data: lastInfoData,
                        final: true
                    });
                }
                // Process pending search if any
                if (pendingSearch) {
                    const ps = pendingSearch;
                    pendingSearch = null;
                    doSearch(ps.fen, ps.moves);
                }
            }
        };

        engine.printErr = (line) => {
            console.error('[engine]', line);
        };

        // Wait for engine to be ready
        await waitForReady();
        engineReady = true;

        // Initialize engine for minixiangqi
        sendCommand('uci');
        sendCommand('setoption name UCI_Variant value minixiangqi');
        sendCommand('setoption name Use NNUE value false');
        sendCommand('isready');

        self.postMessage({ type: 'ready' });
    } catch (err) {
        self.postMessage({ type: 'error', data: 'Failed to initialize engine: ' + err.message });
    }
}

function waitForReady() {
    return new Promise((resolve) => {
        function check() {
            if (engine && engine._isReady && engine._isReady()) {
                resolve();
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
    // Stop current search if running
    if (isSearching) {
        sendCommand('stop');
        // Queue this search to run after bestmove
        pendingSearch = { fen, moves };
        return;
    }

    // Set up position
    const movesStr = moves && moves.length > 0 ? ' moves ' + moves.join(' ') : '';
    sendCommand('position startpos' + movesStr);

    // Start search
    lastInfoData = null;
    isSearching = true;
    sendCommand('go depth 15');
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