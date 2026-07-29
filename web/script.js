// Mini Xiangqi - AI Mode
// Uses Fairy-Stockfish WASM engine with NNUE

let ffish = null;
let board = null;
let moveHistory = [];
let flipped = false;
let aiThinking = false;
let gameOver = false;
let selectedSquare = null;
let validMoves = [];
let lastMoveFrom = null;
let lastMoveTo = null;
let searchNodes = 0;
let searchStartTime = 0;
let searchTimeout = false;
const SEARCH_TIME = 3000; // 3 seconds per move

// Analysis state
let analysisDepth = 0;
let analysisScore = 0;
let analysisNodes = 0;
let analysisPV = '';
let analysisMateIn = null;

// DOM Elements
const statusEl = document.getElementById('status');
const boardDisplay = document.getElementById('board-display');
const infoFen = document.getElementById('info-fen');
const infoTurn = document.getElementById('info-turn');
const infoMoves = document.getElementById('info-moves');
const analysisStatsEl = document.getElementById('analysis-stats');
const analysisPVEl = document.getElementById('analysis-pv');
const btnUndo = document.getElementById('btn-undo');
const btnFlip = document.getElementById('btn-flip');
const btnNewGame = document.getElementById('btn-new-game');

// Piece values for evaluation
const PIECE_VALUES = {
  'K': 10000, 'k': -10000,
  'A': 500,   'a': -500,
  'B': 500,   'b': -500,
  'R': 900,   'r': -900,
  'N': 400,   'n': -400,
  'C': 450,   'c': -450,
  'P': 100,   'p': -100,
  // Standard chess pieces
  'Q': 900,   'q': -900,
  'G': 500,   'g': -500,
  'E': 500,   'e': -500,
  'S': 500,   's': -500,
  'M': 300,   'm': -300,
};

// Chinese piece name mapping
const PIECE_CN = {
  'R': '车', 'r': '车',
  'N': '马', 'n': '马',
  'C': '炮', 'c': '炮',
  'B': '象', 'b': '象',
  'A': '士', 'a': '士',
  'K': '帅', 'k': '将',
  'P': '兵', 'p': '卒',
};

// Chinese numerals for red's column
const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

// Direction mapping
const DIR_CN = { '+': '进', '-': '退', '=': '平' };

function setStatus(text, className) {
  statusEl.textContent = text;
  statusEl.className = className || 'status-loading';
}

// Initialize the WASM engine
async function initEngine() {
  try {
    setStatus('引擎加载中...', 'status-loading');
    analysisStatsEl.textContent = '引擎加载中...';
    analysisPVEl.textContent = '';

    ffish = await Module({
      locateFile: (file) => {
        if (file.endsWith('.wasm')) return 'ffish.wasm';
        if (file.endsWith('.data')) return 'ffish.data';
        return file;
      }
    });

    // Set NNUE eval file for minixiangqi
    try {
      ffish.setOption('EvalFile', 'minixiangqi.nnue');
    } catch(e) {
      // NNUE not available in this build, that's OK
    }

    setStatus('引擎就绪', 'status-ready');
    newGame();
    return true;
  } catch (err) {
    setStatus('加载失败: ' + err.message, 'status-error');
    analysisStatsEl.textContent = '引擎加载失败';
    console.error('Engine init failed:', err);
    return false;
  }
}

// Create a new game
function newGame() {
  if (board) board.delete();
  board = new ffish.Board('minixiangqi');
  moveHistory = [];
  gameOver = false;
  selectedSquare = null;
  validMoves = [];
  lastMoveFrom = null;
  lastMoveTo = null;
  analysisDepth = 0;
  analysisScore = 0;
  analysisNodes = 0;
  analysisPV = '';
  analysisMateIn = null;
  renderBoard();
  updateInfo();
  updateButtons();
  analysisStatsEl.textContent = '新局开始 - 红方先行';
  analysisPVEl.textContent = '';
  setStatus('红方走子', 'status-ready');
}

// Set FEN from input
function setFen(fen) {
  if (!board) return;
  try {
    board.setFen(fen);
    moveHistory = [];
    gameOver = false;
    selectedSquare = null;
    validMoves = [];
    lastMoveFrom = null;
    lastMoveTo = null;
    renderBoard();
    updateInfo();
    updateButtons();
    analysisStatsEl.textContent = 'FEN 已设置';
    analysisPVEl.textContent = '';
  } catch(e) {
    console.error('Set FEN error:', e);
  }
}

// Render the board
function renderBoard() {
  if (!board) return;
  try {
    const data = JSON.parse(board.boardData());
    const files = data.files;
    const ranks = data.ranks;
    const boardArray = data.board;
    const checkedPieces = data.checkedPieces.trim().split(/\s+/).filter(s => s);
    const isCheck = data.isCheck;

    // Build valid move set for highlighting
    const validMoveSet = new Set();
    const captureMoveSet = new Set();
    if (selectedSquare) {
      validMoves.forEach(m => {
        validMoveSet.add(m.to);
        if (m.capture) captureMoveSet.add(m.to);
      });
    }

    let html = '';
    const rankRange = flipped
      ? Array.from({length: ranks}, (_, i) => i)
      : Array.from({length: ranks}, (_, i) => ranks - 1 - i);

    for (let ri = 0; ri < ranks; ri++) {
      const r = rankRange[ri];
      html += '<div class="row">';
      const rankNum = flipped ? (ri + 1) : (ranks - ri);
      html += '<span class="rank-label">' + rankNum + '</span>';

      const fileRange = flipped
        ? Array.from({length: files}, (_, i) => files - 1 - i)
        : Array.from({length: files}, (_, i) => i);

      for (let fi = 0; fi < files; fi++) {
        const f = fileRange[fi];
        const piece = boardArray[r][f];
        const isPiece = piece !== '';
        const isWhite = isPiece && piece === piece.toUpperCase() && piece !== '~';
        const isBlack = isPiece && piece === piece.toLowerCase() && piece !== '~';

        // UCI square for this display cell
        const uciFile = String.fromCharCode(97 + f);
        const uciRank = ranks - r;
        const uciSq = uciFile + uciRank;

        const isChecked = checkedPieces.includes(uciSq);
        const isSelected = selectedSquare === uciSq;
        const isValidMove = validMoveSet.has(uciSq);
        const isCapture = captureMoveSet.has(uciSq);
        const isLastMove = uciSq === lastMoveFrom || uciSq === lastMoveTo;

        let cellClass = 'cell';
        if (!isPiece) cellClass += ' empty';
        if (isWhite) cellClass += ' white-piece';
        if (isBlack) cellClass += ' black-piece';
        if (isChecked && !isSelected) cellClass += ' check';
        if (isSelected) cellClass += ' selected';
        if (isValidMove) cellClass += ' valid-move';
        if (isCapture) cellClass += ' capture-move';
        if (isLastMove) cellClass += ' last-move';

        html += '<div class="' + cellClass + '" data-sq="' + uciSq + '">';
        html += isPiece ? formatPieceDisplay(piece) : '.';
        html += '</div>';
      }
      html += '</div>';
    }
    boardDisplay.innerHTML = html;

    // Add file labels at bottom
    let fileLabels = '<div class="row" style="margin-top: 2px;">';
    fileLabels += '<span class="rank-label"></span>';
    const labelRange = flipped
      ? Array.from({length: files}, (_, i) => files - 1 - i)
      : Array.from({length: files}, (_, i) => i);
    for (let fi = 0; fi < files; fi++) {
      const f = labelRange[fi];
      fileLabels += '<span class="rank-label" style="width:34px;">' + String.fromCharCode(97 + f) + '</span>';
    }
    fileLabels += '</div>';
    boardDisplay.innerHTML += fileLabels;

  } catch(e) {
    console.error('Render error:', e);
  }
}

// Format piece character for display (use Chinese characters for xiangqi pieces)
function formatPieceDisplay(piece) {
  const clean = piece.replace('~', '');
  const cnMap = {
    'K': '帅', 'k': '将',
    'A': '仕', 'a': '士',
    'B': '相', 'b': '象',
    'R': '车', 'r': '车',
    'N': '马', 'n': '马',
    'C': '炮', 'c': '炮',
    'P': '兵', 'p': '卒',
  };
  return cnMap[clean] || piece;
}

// Update board info display
function updateInfo() {
  if (!board) return;
  try {
    const data = JSON.parse(board.boardData());
    infoFen.textContent = 'FEN: ' + data.fen;
    const isRed = data.turn;
    infoTurn.textContent = flipped
      ? (isRed ? '红方走子' : '黑方走子')
      : (isRed ? '红方走子' : '黑方走子');
    infoMoves.textContent = '回合: ' + board.fullmoveNumber();
  } catch(e) {}
}

// Update button states
function updateButtons() {
  btnUndo.disabled = moveHistory.length === 0 || aiThinking;
}

// Show game result
function showResult(result) {
  let text = '';
  switch(result) {
    case '1-0': text = '红方胜！'; break;
    case '0-1': text = '黑方胜！'; break;
    case '1/2-1/2': text = '和棋'; break;
    default: return;
  }
  gameOver = true;
  setStatus('游戏结束: ' + text, 'status-ready');
  analysisStatsEl.textContent = '游戏结束: ' + text;
  updateButtons();
}

// Convert WXF notation to human-readable Chinese notation
function wxfToChinese(wxfMove) {
  if (!wxfMove) return '';
  // WXF format: PieceLetter + SourceColumn + Direction(+/-/=) + Steps
  // e.g. "R1+2" -> "车一进二", "C2=5" -> "炮二平五"
  const match = wxfMove.match(/^([RNBCAKPrnbcakp])(\d)([+\-=])(\d+)$/);
  if (!match) return wxfMove;

  const piece = match[1];
  const col = parseInt(match[2]);
  const dir = match[3];
  const steps = parseInt(match[4]);

  // Piece name in Chinese
  const pieceName = PIECE_CN[piece] || piece;

  // Column number: red uses Chinese numerals, black uses Arabic
  const isRed = piece === piece.toUpperCase();
  const colStr = isRed ? CN_NUM[col] : String(col);

  // Direction
  const dirStr = DIR_CN[dir] || dir;

  // Steps
  const stepsStr = isRed ? CN_NUM[steps] : String(steps);

  // For horizontal moves (=), the steps number is the destination column
  if (dir === '=') {
    return pieceName + colStr + dirStr + (isRed ? CN_NUM[steps] : String(steps));
  }
  return pieceName + colStr + dirStr + stepsStr;
}

// Convert a UCI move to Chinese notation
function uciToChinese(uciMove) {
  if (!uciMove || !board) return '';
  try {
    const san = board.sanMove(uciMove, ffish.Notation.XIANGQI_WXF);
    return wxfToChinese(san);
  } catch(e) {
    return uciMove;
  }
}

// Convert PV (array of UCI moves) to Chinese notation string
function pvToChinese(pvArray) {
  if (!pvArray || pvArray.length === 0) return '';
  return pvArray.map(m => uciToChinese(m)).join(' ');
}

// Update analysis display
function updateAnalysisDisplay() {
  if (analysisDepth === 0) {
    analysisStatsEl.textContent = '等待分析...';
    analysisPVEl.textContent = '';
    return;
  }

  let statsHtml = '';
  statsHtml += '<span class="depth-val">深度: ' + analysisDepth + '</span>';
  statsHtml += ' &nbsp;|&nbsp; ';

  if (analysisMateIn !== null) {
    const mateText = analysisMateIn > 0
      ? '绝杀 ' + analysisMateIn + ' 步'
      : '被绝杀 ' + Math.abs(analysisMateIn) + ' 步';
    statsHtml += '<span class="mate-val">' + mateText + '</span>';
  } else {
    const scoreText = analysisScore >= 0 ? '+' + analysisScore : '' + analysisScore;
    const scoreLabel = analysisScore > 0 ? '红优' : analysisScore < 0 ? '黑优' : '均势';
    statsHtml += '<span class="score-val">分数: ' + scoreText + ' (' + scoreLabel + ')</span>';
  }

  statsHtml += ' &nbsp;|&nbsp; ';
  statsHtml += '<span class="nodes-val">节点: ' + formatNumber(analysisNodes) + '</span>';

  analysisStatsEl.innerHTML = statsHtml;
  analysisPVEl.textContent = analysisPV;
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

// Evaluate position (material + mobility)
function evaluatePosition(pos) {
  try {
    const data = JSON.parse(pos.boardData());
    const boardArray = data.board;
    const ranks = data.ranks;
    const files = data.files;
    const turn = data.turn;

    let score = 0;
    for (let r = 0; r < ranks; r++) {
      for (let f = 0; f < files; f++) {
        const piece = boardArray[r][f];
        if (piece && piece !== '') {
          const cleanPiece = piece.replace('~', '');
          score += PIECE_VALUES[cleanPiece] || 0;
        }
      }
    }

    // Mobility bonus
    const numMoves = pos.numberLegalMoves();
    score += turn ? numMoves * 3 : -numMoves * 3;

    return score;
  } catch(e) {
    return 0;
  }
}

// Simple move ordering: captures first
function orderMoves(board, moves) {
  return moves.sort((a, b) => {
    const aCap = board.isCapture(a) ? 1 : 0;
    const bCap = board.isCapture(b) ? 1 : 0;
    return bCap - aCap;
  });
}

// Alpha-beta negamax search
const MATE_SCORE = 99999;

function negamax(pos, depth, alpha, beta) {
  searchNodes++;

  // Check timeout
  if (searchNodes % 1000 === 0 && Date.now() - searchStartTime > SEARCH_TIME) {
    searchTimeout = true;
    return null;
  }

  if (depth === 0) {
    return { score: evaluatePosition(pos), pv: [] };
  }

  if (pos.isGameOver()) {
    const result = pos.result();
    if (result === '1-0') return { score: MATE_SCORE + depth, pv: [] };
    if (result === '0-1') return { score: -(MATE_SCORE + depth), pv: [] };
    return { score: 0, pv: [] };
  }

  const moves = pos.legalMoves().split(' ').filter(m => m);
  if (moves.length === 0) {
    // No legal moves - checkmate or stalemate
    if (pos.isCheck()) {
      return { score: -(MATE_SCORE + depth), pv: [] };
    }
    return { score: 0, pv: [] };
  }

  const orderedMoves = orderMoves(pos, moves);

  let bestScore = -Infinity;
  let bestPV = [];
  let bestMove = orderedMoves[0];

  for (const move of orderedMoves) {
    pos.push(move);
    const result = negamax(pos, depth - 1, -beta, -alpha);
    pos.pop();

    if (result === null || searchTimeout) {
      if (bestMove !== null) {
        return { score: bestScore, pv: bestPV, bestMove };
      }
      return null;
    }

    const score = -result.score;
    if (score > bestScore) {
      bestScore = score;
      bestPV = [move, ...result.pv];
      bestMove = move;
    }
    alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
    if (searchTimeout) break;
  }

  return { score: bestScore, pv: bestPV, bestMove };
}

// Quiescence search to handle captures
function quiesce(pos, alpha, beta) {
  searchNodes++;

  if (searchNodes % 500 === 0 && Date.now() - searchStartTime > SEARCH_TIME) {
    searchTimeout = true;
    return evaluatePosition(pos);
  }

  const standPat = evaluatePosition(pos);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;

  const moves = pos.legalMoves().split(' ').filter(m => m);
  const captures = moves.filter(m => pos.isCapture(m));

  for (const move of captures) {
    pos.push(move);
    const score = -quiesce(pos, -beta, -alpha);
    pos.pop();

    if (searchTimeout) return alpha;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }

  return alpha;
}

// AI search with iterative deepening
async function aiSearch() {
  if (!board || aiThinking || gameOver) return null;

  aiThinking = true;
  searchNodes = 0;
  searchStartTime = Date.now();
  searchTimeout = false;
  setStatus('AI 思考中...', 'status-thinking');

  let bestMove = null;
  let bestScore = 0;
  let bestPV = [];
  let mateIn = null;

  const maxDepth = 20;

  for (let depth = 1; depth <= maxDepth; depth++) {
    searchTimeout = false;
    const depthStartNodes = searchNodes;

    const result = negamax(board, depth, -Infinity, Infinity);

    if (searchTimeout) {
      break;
    }

    if (result && result.bestMove) {
      bestMove = result.bestMove;
      bestScore = result.score;
      bestPV = result.pv;
      analysisDepth = depth;
      analysisScore = bestScore;

      // Check for mate
      if (Math.abs(bestScore) > MATE_SCORE - 100) {
        const mateSteps = MATE_SCORE - Math.abs(bestScore);
        mateIn = bestScore > 0 ? Math.ceil(mateSteps / 2) : -Math.ceil(mateSteps / 2);
      } else {
        mateIn = null;
      }
      analysisMateIn = mateIn;
      analysisNodes = searchNodes;
      analysisPV = pvToChinese(bestPV);
      updateAnalysisDisplay();
    }

    if (board.isGameOver()) break;
    if (Date.now() - searchStartTime > SEARCH_TIME * 0.5 && depth >= 4) break;
    if (depth >= 8) break;
  }

  analysisDepth = analysisDepth || 1;
  analysisNodes = searchNodes;
  analysisPV = pvToChinese(bestPV);
  updateAnalysisDisplay();

  aiThinking = false;
  return { bestMove, bestScore, bestPV };
}

// Make a human move
function makeHumanMove(uciMove) {
  if (!board || aiThinking || gameOver) return false;

  try {
    const legalMoves = board.legalMoves().split(' ').filter(m => m);
    if (!legalMoves.includes(uciMove)) return false;

    board.push(uciMove);
    moveHistory.push(uciMove);
    lastMoveFrom = uciMove.substring(0, 2);
    lastMoveTo = uciMove.substring(2, 4);
    selectedSquare = null;
    validMoves = [];
    renderBoard();
    updateInfo();
    updateButtons();

    // Check game result
    const result = board.result();
    if (result !== '*') {
      showResult(result);
      return true;
    }

    // Trigger AI move
    setStatus('AI 思考中...', 'status-thinking');
    setTimeout(() => makeAIMove(), 200);
    return true;
  } catch(e) {
    console.error('Move error:', e);
    return false;
  }
}

// Make AI move
async function makeAIMove() {
  if (!board || gameOver) {
    aiThinking = false;
    return;
  }

  try {
    const result = await aiSearch();

    if (!result || !result.bestMove) {
      // No move found, try direct legal move
      const legalMoves = board.legalMoves().split(' ').filter(m => m);
      if (legalMoves.length > 0) {
        const move = legalMoves[0];
        board.push(move);
        moveHistory.push(move);
        lastMoveFrom = move.substring(0, 2);
        lastMoveTo = move.substring(2, 4);
      }
    } else {
      board.push(result.bestMove);
      moveHistory.push(result.bestMove);
      lastMoveFrom = result.bestMove.substring(0, 2);
      lastMoveTo = result.bestMove.substring(2, 4);
    }

    renderBoard();
    updateInfo();
    updateButtons();

    const gameResult = board.result();
    if (gameResult !== '*') {
      showResult(gameResult);
    } else {
      setStatus('红方走子', 'status-ready');
    }
  } catch(e) {
    console.error('AI move error:', e);
    setStatus('AI 出错', 'status-error');
  }

  aiThinking = false;
}

// Undo last move(s)
function undoMove() {
  if (!board || moveHistory.length === 0 || aiThinking) return;

  // Undo AI move + human move (2 moves)
  const undoCount = Math.min(2, moveHistory.length);
  for (let i = 0; i < undoCount; i++) {
    board.pop();
    moveHistory.pop();
  }

  selectedSquare = null;
  validMoves = [];
  lastMoveFrom = null;
  lastMoveTo = null;
  gameOver = false;
  analysisDepth = 0;
  analysisScore = 0;
  analysisNodes = 0;
  analysisPV = '';
  analysisMateIn = null;
  renderBoard();
  updateInfo();
  updateButtons();
  analysisStatsEl.textContent = '已悔棋';
  analysisPVEl.textContent = '';
  setStatus('红方走子', 'status-ready');
}

// Flip board
function flipBoard() {
  flipped = !flipped;
  renderBoard();
  updateInfo();
}

// Board click handler
boardDisplay.addEventListener('click', (e) => {
  if (aiThinking || gameOver) return;

  const cell = e.target.closest('.cell');
  if (!cell) return;

  const sq = cell.dataset.sq;
  if (!sq) return;

  // Check if it's human's turn (red/white = true)
  if (!board.turn()) {
    // AI's turn, don't allow clicks
    return;
  }

  // Check if clicking a valid move destination
  if (selectedSquare && validMoves.find(m => m.to === sq)) {
    // Find the move UCI
    const move = validMoves.find(m => m.to === sq);
    if (move) {
      makeHumanMove(move.uci);
    }
    return;
  }

  // Check if clicking on a red piece
  try {
    const data = JSON.parse(board.boardData());
    const boardArray = data.board;
    const ranks = data.ranks;
    const file = sq.charCodeAt(0) - 97;
    const rank = ranks - parseInt(sq.substring(1));

    if (rank < 0 || rank >= ranks || file < 0 || file >= data.files) return;

    const piece = boardArray[rank][file];
    if (!piece || piece === '') return;

    const isRed = piece === piece.toUpperCase() && piece !== '~';

    if (isRed) {
      // Select this piece
      selectedSquare = sq;
      // Get legal moves for this piece
      const legalMoves = board.legalMoves().split(' ').filter(m => m);
      validMoves = legalMoves
        .filter(m => m.startsWith(sq))
        .map(m => ({
          uci: m,
          to: m.substring(2, 4),
          capture: board.isCapture(m)
        }));
      renderBoard();
    } else {
      // Clicking on black piece - deselect
      selectedSquare = null;
      validMoves = [];
      renderBoard();
    }
  } catch(e) {
    console.error('Click handler error:', e);
  }
});

// Event listeners
btnUndo.addEventListener('click', undoMove);
btnFlip.addEventListener('click', flipBoard);
btnNewGame.addEventListener('click', newGame);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'u' && e.ctrlKey) {
    e.preventDefault();
    undoMove();
  }
  if (e.key === 'f' && e.ctrlKey) {
    e.preventDefault();
    flipBoard();
  }
  if (e.key === 'n' && e.ctrlKey) {
    e.preventDefault();
    newGame();
  }
});

// Expose for debugging
window.__board = () => board;
window.__setFen = (fen) => setFen(fen);

// Initialize
initEngine();