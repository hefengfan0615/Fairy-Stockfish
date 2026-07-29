// Fairy-Stockfish WASM Engine - Web Interface
let ffish = null;
let board = null;
let moveHistory = [];
let isAIThinking = false;

const statusEl = document.getElementById('status');
const boardDisplay = document.getElementById('board-display');
const infoFen = document.getElementById('info-fen');
const infoTurn = document.getElementById('info-turn');
const infoMoves = document.getElementById('info-moves');
const moveHistoryEl = document.getElementById('move-history');
const engineOutputEl = document.getElementById('engine-output');
const variantSelect = document.getElementById('variant-select');
const fenInput = document.getElementById('fen-input');
const searchDepth = document.getElementById('search-depth');

function setStatus(text, className) {
  statusEl.textContent = text;
  statusEl.className = className || 'status-loading';
}

function logEngine(text) {
  engineOutputEl.textContent += text + '\n';
  engineOutputEl.scrollTop = engineOutputEl.scrollHeight;
}

// Initialize the WASM engine
async function initEngine() {
  try {
    setStatus('Loading WASM engine...', 'status-loading');
    logEngine('Loading Fairy-Stockfish WASM engine...');

    ffish = await Module({
      locateFile: (file) => {
        // Try to load from the same directory
        if (file.endsWith('.wasm')) return 'ffish.wasm';
        if (file.endsWith('.data')) return 'ffish.data';
        return file;
      }
    });

    logEngine('Engine loaded: ' + ffish.info());
    logEngine('Available variants: ' + ffish.variants().split(' ').length);
    logEngine('Has minixiangqi: ' + ffish.variants().includes('minixiangqi'));

    // Set NNUE eval file for minixiangqi
    try {
      ffish.setOption('EvalFile', 'minixiangqi.nnue');
      logEngine('NNUE EvalFile set to: minixiangqi.nnue');
    } catch(e) {
      logEngine('NNUE EvalFile not available (non-embedded build)');
    }

    setStatus('Engine ready!', 'status-ready');
    newGame();
    return true;
  } catch (err) {
    setStatus('Failed to load engine: ' + err.message, 'status-error');
    logEngine('ERROR: ' + err.message);
    console.error('Engine init failed:', err);
    return false;
  }
}

// Create a new game
function newGame() {
  if (board) board.delete();
  const variant = variantSelect.value;
  board = new ffish.Board(variant);
  moveHistory = [];
  renderBoard();
  updateInfo();
  updateMoveHistory();
  logEngine('New game: ' + variant);
}

// Set FEN from input
function setFen() {
  const fen = fenInput.value.trim();
  if (!board) return;
  try {
    if (fen) {
      if (ffish.validateFen(fen, variantSelect.value) === 1) {
        board.setFen(fen);
        moveHistory = [];
        renderBoard();
        updateInfo();
        updateMoveHistory();
        logEngine('FEN set: ' + fen);
      } else {
        logEngine('ERROR: Invalid FEN');
        alert('Invalid FEN string');
      }
    } else {
      board.reset();
      moveHistory = [];
      renderBoard();
      updateInfo();
      updateMoveHistory();
      logEngine('Board reset to start position');
    }
  } catch(e) {
    logEngine('ERROR: ' + e.message);
    alert('Error: ' + e.message);
  }
}

// Render the board from engine data
function renderBoard() {
  if (!board) return;
  try {
    const data = JSON.parse(board.boardData());
    const files = data.files;
    const ranks = data.ranks;
    const boardArray = data.board;
    const checkedPieces = data.checkedPieces.trim().split(/\s+/).filter(s => s);
    const isCheck = data.isCheck;

    let html = '';
    for (let r = 0; r < ranks; r++) {
      html += '<div class="row">';
      const rankLabel = ranks - r;
      html += '<span class="rank-label">' + rankLabel + '</span>';
      for (let f = 0; f < files; f++) {
        const piece = boardArray[r][f];
        const isPiece = piece !== '';
        // Determine if this is a white piece (uppercase) or black piece (lowercase)
        const isWhite = isPiece && piece === piece.toUpperCase() && piece !== '~';
        const isBlack = isPiece && piece === piece.toLowerCase() && piece !== '~';
        // Check if this square is in check
        const sq = String.fromCharCode(97 + f) + (ranks - r);
        const isChecked = checkedPieces.includes(sq);

        let cellClass = 'cell';
        if (!isPiece) cellClass += ' empty';
        if (isWhite) cellClass += ' white-piece';
        if (isBlack) cellClass += ' black-piece';
        if (isChecked) cellClass += ' check';

        html += '<div class="' + cellClass + '" data-file="' + f + '" data-rank="' + r + '">';
        html += isPiece ? piece : '.';
        html += '</div>';
      }
      html += '</div>';
    }
    boardDisplay.innerHTML = html;

    // Add file labels at bottom
    let fileLabels = '<div class="row" style="margin-top: 4px;">';
    fileLabels += '<span class="rank-label"></span>';
    for (let f = 0; f < files; f++) {
      fileLabels += '<span class="rank-label" style="width:32px;">' + String.fromCharCode(97 + f) + '</span>';
    }
    fileLabels += '</div>';
    boardDisplay.innerHTML += fileLabels;

    // Update info
    infoFen.textContent = 'FEN: ' + data.fen;
    infoTurn.textContent = 'Turn: ' + (data.turn ? 'White' : 'Black');
    infoMoves.textContent = 'Legal moves: ' + board.numberLegalMoves();
  } catch(e) {
    logEngine('Render error: ' + e.message);
  }
}

// Update board info
function updateInfo() {
  if (!board) return;
  try {
    const data = JSON.parse(board.boardData());
    infoFen.textContent = 'FEN: ' + data.fen;
    infoTurn.textContent = 'Turn: ' + (data.turn ? 'White' : 'Black');
    infoMoves.textContent = 'Legal moves: ' + board.numberLegalMoves();
  } catch(e) {}
}

// Update move history display
function updateMoveHistory() {
  moveHistoryEl.innerHTML = '';
  moveHistory.forEach((move, i) => {
    const moveNum = Math.floor(i / 2) + 1;
    const prefix = (i % 2 === 0) ? moveNum + '. ' : '';
    const el = document.createElement('span');
    el.className = 'move-item';
    el.textContent = prefix + move + ' ';
    moveHistoryEl.appendChild(el);
  });
  moveHistoryEl.scrollTop = moveHistoryEl.scrollHeight;
}

// Make an AI move
async function aiMove() {
  if (!board || isAIThinking) return;
  if (board.isGameOver()) {
    logEngine('Game is over: ' + board.result());
    return;
  }

  isAIThinking = true;
  setStatus('AI thinking...', 'status-thinking');
  document.getElementById('btn-ai-move').disabled = true;

  try {
    const depth = parseInt(searchDepth.value);
    const fen = board.fen();
    const variant = variantSelect.value;
    logEngine('Searching (depth=' + depth + ') from: ' + fen);

    // Perform search using go command via UCI
    // Since ffish.js doesn't expose UCI directly, we use a workaround:
    // We'll use the legal moves and pick the best one by evaluating each position
    const legalMoves = board.legalMoves().split(' ');
    if (legalMoves.length === 0) {
      logEngine('No legal moves available');
      isAIThinking = false;
      setStatus('Engine ready', 'status-ready');
      document.getElementById('btn-ai-move').disabled = false;
      return;
    }

    // Simple evaluation-based move selection (since we can't use UCI go directly)
    let bestMove = legalMoves[0];
    let bestScore = -Infinity;

    for (const move of legalMoves) {
      board.push(move);
      // Use the built-in evaluation through the position
      // For a more sophisticated approach, we could implement UCI go
      const score = evaluatePosition(board);
      board.pop();

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    logEngine('Best move: ' + bestMove + ' (score: ' + bestScore + ')');

    // Apply the best move
    board.push(bestMove);
    moveHistory.push(bestMove);
    renderBoard();
    updateInfo();
    updateMoveHistory();

    const result = board.result();
    if (result !== '*') {
      logEngine('Game over: ' + result);
      setStatus('Game over: ' + result, 'status-ready');
    } else {
      setStatus('Engine ready', 'status-ready');
    }

  } catch(e) {
    logEngine('AI error: ' + e.message);
    setStatus('Error: ' + e.message, 'status-error');
  }

  isAIThinking = false;
  document.getElementById('btn-ai-move').disabled = false;
}

// Simple position evaluation based on material count
function evaluatePosition(pos) {
  try {
    const data = JSON.parse(pos.boardData());
    const boardArray = data.board;
    const turn = data.turn;
    const files = data.files;
    const ranks = data.ranks;

    // Piece values for minixiangqi/xiangqi
    const pieceValues = {
      'K': 10000, 'k': -10000,
      'G': 500,   'g': -500,   // Guard/Advisor
      'E': 500,   'e': -500,   // Elephant/Bishop
      'R': 900,   'r': -900,   // Rook/Chariot
      'N': 400,   'n': -400,   // Knight/Horse
      'C': 450,   'c': -450,   // Cannon
      'P': 100,   'p': -100,   // Pawn/Soldier
      'B': 300,   'b': -300,   // Bishop (for chess)
      'Q': 900,   'q': -900,   // Queen (for chess)
      'A': 500,   'a': -500,   // Advisor (for xiangqi)
      'S': 500,   's': -500,   // Silver (for shogi)
      'M': 300,   'm': -300,   // etc.
    };

    let score = 0;
    for (let r = 0; r < ranks; r++) {
      for (let f = 0; f < files; f++) {
        const piece = boardArray[r][f];
        if (piece && piece !== '') {
          // Remove promotion marker (~) for value lookup
          const cleanPiece = piece.replace('~', '');
          const val = pieceValues[cleanPiece] || 0;
          score += val;
        }
      }
    }

    // Add mobility bonus (number of legal moves)
    const numMoves = pos.numberLegalMoves();
    const mobilityBonus = turn ? numMoves * 5 : -numMoves * 5;

    return score + mobilityBonus;
  } catch(e) {
    return 0;
  }
}

// Undo last move
function undoMove() {
  if (!board || moveHistory.length === 0) return;
  board.pop();
  moveHistory.pop();
  renderBoard();
  updateInfo();
  updateMoveHistory();
  logEngine('Undo last move');
}

// Event listeners
document.getElementById('btn-new-game').addEventListener('click', newGame);
document.getElementById('btn-set-fen').addEventListener('click', setFen);
document.getElementById('btn-ai-move').addEventListener('click', aiMove);
document.getElementById('btn-undo').addEventListener('click', undoMove);

variantSelect.addEventListener('change', () => {
  newGame();
  fenInput.value = '';
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement === fenInput) setFen();
});

// Initialize when the module is loaded
initEngine();