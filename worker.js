// Web Worker: 后台引擎无限分析 (go infinite)
// 调用 goInfinite 启动搜索线程，setInterval 轮询读取分析结果

let ffish = null;
let board = null;
let isAnalyzing = false;
let pollTimer = null;

// 动态导入 WASM 引擎
async function initEngine() {
    const Module = await import('./tests/js/ffish.js');
    ffish = await Module.default({
        locateFile: (path) => './tests/js/' + path
    });
}

// 开始 go infinite 分析
function startAnalysis(data) {
    const { fen, moves } = data;
    if (!ffish) return;

    // 清理旧 board（先 stop 再 delete）
    stopAnalysisInternal();

    // 初始局面 + moves 设置
    board = new ffish.Board('minixiangqi');
    board.setFen(fen);
    if (moves && moves.length > 0) {
        for (const move of moves) {
            board.push(move);
        }
    }

    // 启动 go infinite 搜索线程
    board.goInfinite();
    isAnalyzing = true;

    // 每 200ms 轮询读取当前分析结果
    pollTimer = setInterval(() => {
        if (!isAnalyzing || !board) return;
        try {
            const result = board.getAnalysis();
            // 解析 PV 并转换为中文记谱
            let pvChinese = '';
            const parts = result.split(' ');
            const pvIdx = parts.indexOf('pv');
            if (pvIdx >= 0) {
                const pvUci = parts.slice(pvIdx + 1).join(' ');
                try {
                    pvChinese = board.variationSan(pvUci, ffish.Notation.XIANGQI_WXF, false);
                } catch (e) {
                    pvChinese = pvUci;
                }
            }
            self.postMessage({ type: 'analysis', data: result, pvChinese });
        } catch (e) {
            self.postMessage({ type: 'error', data: e.message || String(e) });
        }
    }, 200);
}

function stopAnalysisInternal() {
    isAnalyzing = false;
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    if (board) {
        try { board.stop(); } catch (e) { /* ignore */ }
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
            // 直接停止旧分析，开始新分析
            startAnalysis(data);
            break;

        case 'stop':
            stopAnalysisInternal();
            break;
    }
};