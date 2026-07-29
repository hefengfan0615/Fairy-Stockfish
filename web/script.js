// ===== Mini Xiangqi - Fairy-Stockfish WASM Library + JS Search =====
// Uses ffish.js Board API for move generation + JS negamax search

// === State ===
let ffish = null;
let board = null;
let isAnalyzing = false;
let searchId = 0;
let flipped = false;

// Board state
let selectedSquare = null;
let legalMovesForSelected = [];
let moveHistory = [];
let boardState = [];
let turn = true;
let gameOver = false;
let lastMoveFrom = null;
let lastMoveTo = null;

// DOM refs
const statusEl = document.getElementById('status');
const turnEl = document.getElementById('turn-indicator');
const boardEl = document.getElementById('board');
const fenEl = document.getElementById('fen-display');
const movesEl = document.getElementById('moves');
const outputEl = document.getElementById('output');

// Piece display names
const PIECE_NAMES = {
  'K': { cn: '帅', en: 'King' },
  'k': { cn: '将', en: 'King' },
  'R': { cn: '车', en: 'Rook' },
  'r': { cn: '车', en: 'Rook' },
  'N': { cn: '马', en: 'Horse' },
  'n': { cn: '马', en: 'Horse' },
  'C': { cn: '炮', en: 'Cannon' },
  'c': { cn: '炮', en: 'Cannon' },
  'P': { cn: '兵', en: 'Pawn' },
  'p': { cn: '卒', en: 'Pawn' },
};

// Piece values for material evaluation
const PIECE_VALUES = {
  'K': 10000, 'k': -10000,
  'R': 600,   'r': -600,
  'N': 270,   'n': -270,
  'C': 300,   'c': -300,
  'P': 100,   'p': -100,
};

// Chinese number for files 1-7
const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七'];
const CN_NUM_BLACK = ['', '１', '２', '３', '４', '５', '６', '７'];

// ===================== Search Engine =====================

// Evaluate board from FEN directly
function evaluateFen(fen) {
  const boardStr = fen.split(' ')[0];
  let score = 0;
  for (const ch of boardStr) {
    if (ch >= 'A' && ch <= 'Z') score += PIECE_VALUES[ch] || 0;
    else if (ch >= 'a' && ch <= 'z') score += PIECE_VALUES[ch] || 0;
  }
  return score;
}

// Get legal moves as array (cached)
function getMoves(b) {
  return b.legalMoves().split(' ').filter(m => m.length >= 4);
}

// Negamax with alpha-beta pruning
function negamax(b, depth, alpha, beta, color, nodes) {
  nodes.val++;
  if (nodes.val > 500000) return color * evaluateFen(b.fen()); // safety limit

  if (depth === 0) return color * evaluateFen(b.fen());
  if (b.isGameOver()) {
    const r = b.result();
    if (r === '1-0') return color * 100000;
    if (r === '0-1') return -color * 100000;
    return 0; // draw
  }

  const moves = getMoves(b);
  if (moves.length === 0) return color * evaluateFen(b.fen());

  // Simple move ordering: captures first (by checking if target square has a piece)
  // We can't easily check captures without a board state, so sort by some heuristic
  let best = -Infinity;
  for (const m of moves) {
    b.push(m);
    const val = -negamax(b, depth - 1, -beta, -alpha, -color, nodes);
    b.pop();
    if (val > best) best = val;
    if (val > alpha) alpha = val;
    if (alpha >= beta) break;
  }
  return best;
}

// Root search with PV extraction
function rootSearch(b, maxDepth, nodes) {
  const moves = getMoves(b);
  if (moves.length === 0) return { score: 0, move: null, pv: [], nodes: 0 };

  const color = b.turn() ? 1 : -1;
  const useMate = Math.abs(evaluateFen(b.fen())) > 8000;

  let bestMove = moves[0];
  let bestScore = -Infinity;
  let bestPV = [moves[0]];

  for (const m of moves) {
    b.push(m);
    const score = -negamax(b, maxDepth - 1, -Infinity, Infinity, -color, nodes);
    b.pop();

    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
      // Build a short PV by following the best line
      const pvMoves = [m];
      b.push(m);
      // Try to find a continuation
      const subMoves = getMoves(b);
      if (subMoves.length > 0) {
        let subBest = -Infinity;
        let subBestM = subMoves[0];
        for (const sm of subMoves) {
          b.push(sm);
          const subScore = -negamax(b, Math.min(2, maxDepth - 1), -Infinity, Infinity, -color, nodes);
          b.pop();
          if (subScore > subBest) { subBest = subScore; subBestM = sm; }
        }
        pvMoves.push(subBestM);
      }
      b.pop();
      bestPV = pvMoves;
    }
  }

  return { score: bestScore, move: bestMove, pv: bestPV, nodes: nodes.val };
}

// Start infinite analysis
function startAnalysis() {
  if (gameOver || !board) { stopAnalysis(); return; }
  stopAnalysis();
  isAnalyzing = true;
  clearOutput();
  appendOutput('开始分析...', 'info-line');

  const curSearchId = ++searchId;
  let depth = 1;

  function iteration() {
    if (!isAnalyzing || searchId !== curSearchId || !board || board.isGameOver()) {
      isAnalyzing = false;
      return;
    }
    const nodes = { val: 0 };
    const result = rootSearch(board, depth, nodes);

    if (searchId !== curSearchId) return;

    const isMate = Math.abs(result.score) > 9000;
    let scoreStr;
    if (isMate) {
      const matePlies = Math.round((10000 - Math.abs(result.score)) / 50);
      scoreStr = `绝杀:${matePlies || 1}`;
    } else {
      scoreStr = `分数:${result.score}`;
    }

    const pvStr = result.pv.map(m => uciToChinese(m)).join(' ');
    appendOutput(`深度:${depth}, ${scoreStr}, 节点:${result.nodes}`, 'info-line');
    if (pvStr) appendOutput(`思考路线: ${pvStr}`, 'pv-line');

    depth++;
    if (depth <= 30 && isAnalyzing) {
      setTimeout(iteration, 50);
    }
  }

  setTimeout(iteration, 100);
}

function stopAnalysis() {
  isAnalyzing = false;
  searchId++;
}

// ===================== UCI to Chinese =====================

function uciToChinese(uci) {
  if (!uci || uci.length < 4) return uci;
  const fromFile = uci.charCodeAt(0) - 96;
  const fromRank = parseInt(uci[1]);
  const toFile = uci.charCodeAt(2) - 96;
  const toRank = parseInt(uci[3]);

  const piece = getPieceAt(fromFile, fromRank);
  if (!piece) return uci;

  const isRed = piece === piece.toUpperCase();
  const pieceName = PIECE_NAMES[piece]?.cn || (isRed ? '?' : '?');

  const fromFileCn = isRed ? CN_NUM[fromFile] : CN_NUM_BLACK[8 - fromFile];
  const toFileCn = isRed ? CN_NUM[toFile] : CN_NUM_BLACK[8 - toFile];

  const rankDiff = toRank - fromRank;
  const fileDiff = toFile - fromFile;

  let direction, target;
  if (isRed) {
    if (rankDiff < 0) { direction = '进'; target = (Math.abs(rankDiff) !== Math.abs(fileDiff) && fileDiff !== 0) ? toFileCn : CN_NUM[Math.abs(rankDiff)]; }
    else if (rankDiff > 0) { direction = '退'; target = (Math.abs(rankDiff) !== Math.abs(fileDiff) && fileDiff !== 0) ? toFileCn : CN_NUM[rankDiff]; }
    else { direction = '平'; target = toFileCn; }
  } else {
    if (rankDiff > 0) { direction = '进'; target = (Math.abs(rankDiff) !== Math.abs(fileDiff) && fileDiff !== 0) ? toFileCn : CN_NUM_BLACK[rankDiff]; }
    else if (rankDiff < 0) { direction = '退'; target = (Math.abs(rankDiff) !== Math.abs(fileDiff) && fileDiff !== 0) ? toFileCn : CN_NUM_BLACK[Math.abs(rankDiff)]; }
    else { direction = '平'; target = toFileCn; }
  }

  return `${pieceName}${fromFileCn}${direction}${target}`;
}

function getPieceAt(file, rank) {
  const row = 7 - rank;
  const col = file - 1;
  if (row >= 0 && row < 7 && col >= 0 && col < 7) return boardState[row]?.[col] || null;
  return null;
}

// ===================== Output =====================

function appendOutput(text, className) {
  const div = document.createElement('div');
  div.textContent = text;
  if (className) div.className = className;
  outputEl.appendChild(div);
  outputEl.scrollTop = outputEl.scrollHeight;
}

function clearOutput() { outputEl.innerHTML = ''; }

// ===================== Board Rendering =====================

function renderBoard() {
  if (!board) return;
  try {
    const data = JSON.parse(board.boardData());
    boardState = data.board;
    turn = data.turn;
    gameOver = board.isGameOver();
    if (gameOver && isAnalyzing) { stopAnalysis(); }

    const files = data.files, ranks = data.ranks;
    let html = '';

    for (let r = 0; r < ranks; r++) {
      const dr = flipped ? r : (ranks - 1 - r);
      html += `<div class="coord-rank">${flipped ? (r + 1) : (ranks - r)}</div>`;
      for (let f = 0; f < files; f++) {
        const dc = flipped ? (files - 1 - f) : f;
        const piece = boardState[dr][dc];
        let cls = 'square';
        if (!piece) cls += ' empty';
        if (selectedSquare && selectedSquare.row === dr && selectedSquare.col === dc) cls += ' selected';
        if (legalMovesForSelected.some(m => (m.charCodeAt(2) - 97) === dc && (parseInt(m[3]) - 1) === dr)) cls += ' target-hint';
        if (lastMoveFrom && lastMoveFrom.row === dr && lastMoveFrom.col === dc) cls += ' last-move';
        if (lastMoveTo && lastMoveTo.row === dr && lastMoveTo.col === dc) cls += ' last-move';
        html += `<div class="${cls}" data-row="${dr}" data-col="${dc}">`;
        if (piece) {
          const isWhite = piece === piece.toUpperCase() && piece !== '~';
          html += `<div class="piece ${isWhite ? 'white' : 'black'}">${PIECE_NAMES[piece]?.cn || piece}</div>`;
        }
        html += '</div>';
      }
    }

    html += `<div class="coord-file"></div>`;
    for (let f = 0; f < files; f++) {
      const dc = flipped ? (files - 1 - f) : f;
      html += `<div class="coord-file">${String.fromCharCode(97 + dc)}</div>`;
    }

    boardEl.innerHTML = html;
    fenEl.textContent = `FEN: ${board.fen()}`;
    updateTurn();
    updateMoveHistory();
  } catch (e) { console.error('Render error:', e); }
}

function updateTurn() {
  if (gameOver) {
    const r = board.result();
    turnEl.textContent = r === '1-0' ? '红方胜!' : r === '0-1' ? '黑方胜!' : r === '1/2-1/2' ? '和棋!' : '游戏结束';
    turnEl.className = 'status-ready';
    return;
  }
  turnEl.textContent = `轮到 ${turn ? '红方' : '黑方'} 走棋`;
  turnEl.className = turn ? 'turn-white' : 'turn-black';
  setStatus('分析中...', 'status-analyzing');
}

function updateMoveHistory() {
  movesEl.innerHTML = '';
  moveHistory.forEach((move, i) => {
    if (i % 2 === 0) {
      const span = document.createElement('span');
      span.className = 'move-num';
      span.textContent = `${Math.floor(i / 2) + 1}. `;
      movesEl.appendChild(span);
    }
    const span = document.createElement('span');
    span.className = 'move';
    span.textContent = move;
    movesEl.appendChild(span);
  });
  movesEl.scrollTop = movesEl.scrollHeight;
}

function setStatus(text, className) {
  statusEl.textContent = text;
  statusEl.className = className || 'status-loading';
}

// ===================== Board Interaction =====================

function onSquareClick(e) {
  const sq = e.target.closest('.square');
  if (!sq || gameOver) return;
  const row = parseInt(sq.dataset.row), col = parseInt(sq.dataset.col);
  const piece = boardState[row][col];

  if (selectedSquare) {
    const target = legalMovesForSelected.find(m => (m.charCodeAt(2) - 97) === col && (parseInt(m[3]) - 1) === row);
    if (target) { makeMove(target); return; }
    if (piece && isOwnPiece(piece)) { selectSquare(row, col); return; }
    selectedSquare = null; legalMovesForSelected = []; renderBoard(); return;
  }

  if (piece && isOwnPiece(piece)) selectSquare(row, col);
}

function isOwnPiece(piece) {
  return turn ? (piece === piece.toUpperCase() && piece !== '~') : (piece === piece.toLowerCase() && piece !== '~');
}

function selectSquare(row, col) {
  selectedSquare = { row, col };
  legalMovesForSelected = [];
  const sqFrom = String.fromCharCode(97 + col) + (row + 1);
  legalMovesForSelected = board.legalMoves().split(' ').filter(m => m.startsWith(sqFrom));
  renderBoard();
}

function makeMove(uciMove) {
  stopAnalysis();
  board.push(uciMove);
  lastMoveFrom = { row: parseInt(uciMove[1]) - 1, col: uciMove.charCodeAt(0) - 97 };
  lastMoveTo = { row: parseInt(uciMove[3]) - 1, col: uciMove.charCodeAt(2) - 97 };
  moveHistory.push(uciToChinese(uciMove));
  selectedSquare = null; legalMovesForSelected = [];
  renderBoard();
  setTimeout(() => {
    if (!board.isGameOver()) startAnalysis();
    else { gameOver = true; renderBoard(); appendOutput(`游戏结束: ${board.result()}`, 'best-line'); }
  }, 50);
}

function undoMove() {
  if (moveHistory.length === 0) return;
  stopAnalysis();
  board.pop(); moveHistory.pop();
  if (moveHistory.length > 0) { board.pop(); moveHistory.pop(); }
  lastMoveFrom = null; lastMoveTo = null; selectedSquare = null; legalMovesForSelected = [];
  renderBoard();
  setTimeout(() => { if (!board.isGameOver()) startAnalysis(); }, 50);
}

function newGame() {
  stopAnalysis();
  if (board) board.delete();
  board = new ffish.Board('minixiangqi');
  moveHistory = []; selectedSquare = null; legalMovesForSelected = [];
  lastMoveFrom = null; lastMoveTo = null; gameOver = false;
  clearOutput();
  renderBoard();
  appendOutput('新游戏开始', 'info-line');
  setTimeout(() => { if (board) startAnalysis(); }, 100);
}

// ===================== Initialization =====================

async function init() {
  try {
    setStatus('加载引擎中...', 'status-loading');
    appendOutput('正在加载 Fairy-Stockfish WASM 引擎...', 'info-line');

    const ffishModule = await Module({ locateFile: (f) => f });
    ffish = ffishModule;
    appendOutput(`引擎版本: ${ffish.info()}`, 'info-line');

    const variants = ffish.variants();
    if (!variants.includes('minixiangqi')) {
      appendOutput('错误: minixiangqi 变体不受支持', 'error-line');
      setStatus('错误: minixiangqi 不受支持', 'status-error');
      return;
    }
    appendOutput('支持 minixiangqi 变体 ✓', 'info-line');

    board = new ffish.Board('minixiangqi');
    renderBoard();
    appendOutput('棋盘已初始化', 'info-line');
    setStatus('引擎就绪，开始分析', 'status-ready');
    setTimeout(startAnalysis, 200);
  } catch (err) {
    setStatus('加载失败: ' + err.message, 'status-error');
    appendOutput('错误: ' + err.message, 'error-line');
    console.error('Init failed:', err);
  }
}

// ===================== Event Listeners =====================

boardEl.addEventListener('click', onSquareClick);
document.getElementById('btn-newgame').addEventListener('click', () => { if (board) newGame(); });
document.getElementById('btn-undo').addEventListener('click', undoMove);
document.getElementById('btn-flip').addEventListener('click', () => { flipped = !flipped; renderBoard(); });

init();