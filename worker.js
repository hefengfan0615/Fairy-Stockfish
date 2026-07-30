// Web Worker: 后台引擎无限分析
// 使用 time-bounded 搜索循环模拟 go infinite

let ffish = null;
let board = null;
let isAnalyzing = false;
let pendingRestart = false;
let pendingData = null;

// 动态导入 WASM 引擎
async function initEngine() {
    const Module = await import('./tests/js/ffish.js');
    ffish = await Module.default({
        locateFile: (path) => './tests/js/' + path
    });
}

// 开始分析循环
function startAnalysis(data) {
    const { fen, moves } = data;
    if (!ffish) return;

    // 清理旧 board
    if (board) {
        board.delete();
        board = null;
    }

    // 初始局面 + moves 设置
    board = new ffish.Board('minixiangqi');
    board.setFen(fen);
    if (moves && moves.length > 0) {
        for (const move of moves) {
            board.push(move);
        }
    }

    isAnalyzing = true;
    pendingRestart = false;
    analysisLoop();
}

// 分析循环：每次搜索 500ms，模拟无限分析
function analysisLoop() {
    if (!isAnalyzing || !board) return;

    // 如果收到重新开始信号，跳过本次结果
    if (pendingRestart) {
        pendingRestart = false;
        startAnalysis(pendingData);
        return;
    }

    try {
        // 搜索 500ms，返回深度/分数/节点/PV
        const result = board.go(0, 500);
        if (isAnalyzing && !pendingRestart) {
            // 解析 PV 并转换为中文记谱
            let pvChinese = '';
            const parts = result.split(' ');
            const pvIdx = parts.indexOf('pv');
            if (pvIdx >= 0) {
                const pvUci = parts.slice(pvIdx + 1).join(' ');
                try {
                    pvChinese = board.variationSan(pvUci, ffish.Notation.XIANGQI_WXF, false);
                } catch (e) {
                    pvChinese = pvUci; // 转换失败时显示 UCI
                }
            }
            self.postMessage({ type: 'analysis', data: result, pvChinese });
        }
    } catch (e) {
        self.postMessage({ type: 'error', data: e.message || String(e) });
    }

    // 继续下一轮分析
    if (isAnalyzing) {
        setTimeout(() => analysisLoop(), 50);
    }
}

function stopAnalysis() {
    isAnalyzing = false;
    pendingRestart = false;
    pendingData = null;
    if (board) {
        board.delete();
        board = null;
    }
}

// 主线程消息处理
self.onmessage = async function (e) {
    const { type, data } = e.data;

    switch (type) {
        case 'init':
            await initEngine();
            self.postMessage({ type: 'ready' });
            break;

        case 'start':
            // 如果正在分析中，标记重启
            if (isAnalyzing) {
                pendingRestart = true;
                pendingData = data;
            } else {
                startAnalysis(data);
            }
            break;

        case 'stop':
            stopAnalysis();
            break;
    }
};