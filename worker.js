// Mini Xiangqi (迷你象棋) WASM Engine Worker
// Uses ffish.js (Fairy-Stockfish WASM) for position analysis

import initFfish from './ffish.js';

let ffish = null;
let board = null;
let currentVariant = 'minixiangqi';

// Initialize the WASM engine
async function initEngine() {
    try {
        ffish = await initFfish();
        board = new ffish.Board(currentVariant);
        self.postMessage({ type: 'ready' });
    } catch (err) {
        self.postMessage({ type: 'error', data: 'Failed to initialize engine: ' + err.message });
    }
}

// Set up position from FEN and move list
function setupPosition(fen, moves) {
    if (!board) return;
    board.delete();
    board = new ffish.Board(currentVariant, fen);
    if (moves && moves.length > 0) {
        for (const uci of moves) {
            board.push(uci);
        }
    }
}

// Run analysis on current position (without deep search)
function analyzePosition() {
    if (!board) return null;

    const fen = board.fen();
    const turn = board.turn() ? 'w' : 'b';
    const legalMoves = board.legalMoves().trim();
    const legalMovesList = legalMoves ? legalMoves.split(' ') : [];
    const numLegalMoves = legalMovesList.length;
    const isCheck = board.isCheck();
    const isGameOver = board.isGameOver();
    const gameResult = isGameOver ? board.result() : '*';

    // Get first few legal moves as PV suggestion
    let pvUci = '';
    let pvChinese = '';
    if (legalMovesList.length > 0) {
        const topMoves = legalMovesList.slice(0, 3);
        pvUci = topMoves.join(' ');
        // Convert to Chinese notation for display
        const sanMoves = [];
        for (const uci of topMoves) {
            const san = board.sanMove(uci, ffish.Notation.XIANGQI_WXF);
            sanMoves.push(san || uci);
        }
        pvChinese = sanMoves.join(' ');
    }

    return {
        fen,
        turn,
        legalMoves: numLegalMoves,
        isCheck,
        isGameOver,
        gameResult,
        pvUci,
        pvChinese
    };
}

// Handle messages from main thread
self.onmessage = function (e) {
    const { type, data } = e.data;

    switch (type) {
        case 'init':
            initEngine();
            break;

        case 'start':
            if (!ffish || !board) {
                self.postMessage({ type: 'error', data: 'Engine not initialized' });
                return;
            }
            try {
                const { fen, moves } = data;
                setupPosition(fen, moves);
                const analysis = analyzePosition();
                if (analysis) {
                    // Build info string similar to UCI output
                    const infoStr = `depth 0 score cp 0 nodes 0 pv ${analysis.pvUci}`;
                    self.postMessage({
                        type: 'analysis',
                        data: infoStr,
                        pvChinese: analysis.pvChinese,
                        fen: analysis.fen,
                        turn: analysis.turn,
                        legalMoves: analysis.legalMoves,
                        isCheck: analysis.isCheck,
                        isGameOver: analysis.isGameOver,
                        gameResult: analysis.gameResult
                    });
                }
            } catch (err) {
                self.postMessage({ type: 'error', data: err.message });
            }
            break;

        default:
            break;
    }
};