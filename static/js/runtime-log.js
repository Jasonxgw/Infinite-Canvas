/* 运行日志面板：把后端运行时的终端日志实时拉到前端展示。
   引入本文件后调用 window.openRuntimeLogs() 打开（外壳页侧栏「运行日志」即为此入口）。 */
(function () {
    if (window.RuntimeLog) return;
    const POLL_MS = 1500;
    const FETCH_LIMIT = 800;
    const MAX_ROWS = 3000;
    const LEVELS = ['all', 'info', 'warn', 'error'];
    const state = { open: false, afterId: 0, timer: null, level: 'all', autoScroll: true, rows: [] };
    let modal = null, listEl = null, countEl = null, autoBtn = null, copyTimer = null;

    function isEn() {
        try { return (window.StudioI18n?.lang?.() || localStorage.getItem('studio_lang')) === 'en'; } catch (e) { return false; }
    }
    function L(zh, en) { return isEn() ? en : zh; }
    function esc(text) {
        return String(text ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    }
    function pad(value) { return String(value).padStart(2, '0'); }
    function timeText(ts) {
        const d = new Date(Number(ts) || Date.now());
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    function injectStyle() {
        if (document.getElementById('rtLogStyle')) return;
        const style = document.createElement('style');
        style.id = 'rtLogStyle';
        style.textContent = `
.rtlog-modal{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;padding:26px;background:rgba(15,23,42,.45);backdrop-filter:blur(8px)}
.rtlog-modal.open{display:flex}
.rtlog-panel{width:min(1100px,95vw);height:min(760px,88vh);display:flex;flex-direction:column;border-radius:18px;border:1px solid var(--line,#e2e8f0);background:var(--card-solid,#fff);box-shadow:0 30px 90px rgba(15,23,42,.3);overflow:hidden}
.rtlog-head{height:54px;flex:0 0 auto;padding:0 12px 0 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line,#e2e8f0)}
.rtlog-title{display:flex;align-items:baseline;gap:8px;font-size:14px;font-weight:900;color:var(--text,#0f172a)}
.rtlog-count{font-size:11px;font-weight:800;color:var(--faint,#94a3b8)}
.rtlog-tools{display:flex;align-items:center;gap:6px}
.rtlog-btn{height:26px;padding:0 9px;border-radius:8px;border:1px solid var(--line,#e2e8f0);background:var(--soft,#f8fafc);color:var(--muted,#64748b);font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap}
.rtlog-btn:hover{border-color:rgba(59,130,246,.45);color:#1d4ed8}
.rtlog-btn.active{background:rgba(59,130,246,.14);border-color:rgba(59,130,246,.35);color:#1d4ed8}
.rtlog-list{flex:1;min-height:0;overflow:auto;padding:8px 12px 16px;background:var(--soft,#f8fafc);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.55}
.rtlog-row{display:grid;grid-template-columns:62px 42px minmax(0,1fr);gap:8px;padding:2px 0;border-bottom:1px dashed rgba(148,163,184,.16)}
.rtlog-time{color:var(--faint,#94a3b8)}
.rtlog-lv{font-weight:900;color:#64748b}
.rtlog-text{white-space:pre-wrap;word-break:break-all;color:var(--text,#0f172a)}
.rtlog-row.rtlog-warn .rtlog-lv{color:#b45309}
.rtlog-row.rtlog-warn .rtlog-text{color:#92400e}
.rtlog-row.rtlog-error .rtlog-lv{color:#dc2626}
.rtlog-row.rtlog-error .rtlog-text{color:#b91c1c}
.rtlog-list[data-level="info"] .rtlog-row:not(.rtlog-info){display:none}
.rtlog-list[data-level="warn"] .rtlog-row.rtlog-info{display:none}
.rtlog-list[data-level="error"] .rtlog-row:not(.rtlog-error){display:none}
.rtlog-empty{padding:26px;text-align:center;color:var(--muted,#64748b);font-size:12px;font-weight:700}`;
        document.head.appendChild(style);
    }

    function build() {
        if (modal) return;
        injectStyle();
        modal = document.createElement('div');
        modal.id = 'rtLogModal';
        modal.className = 'rtlog-modal';
        modal.innerHTML = `
<div class="rtlog-panel" role="dialog" aria-label="${L('运行日志', 'Runtime Logs')}">
    <div class="rtlog-head">
        <div class="rtlog-title"><span>${L('运行日志', 'Runtime Logs')}</span><span class="rtlog-count">0</span></div>
        <div class="rtlog-tools">
            <button class="rtlog-btn" type="button" data-level="all">${L('全部', 'All')}</button>
            <button class="rtlog-btn" type="button" data-level="info">${L('信息', 'Info')}</button>
            <button class="rtlog-btn" type="button" data-level="warn">${L('警告', 'Warn')}</button>
            <button class="rtlog-btn" type="button" data-level="error">${L('错误', 'Error')}</button>
            <button class="rtlog-btn active" type="button" data-act="autoscroll">${L('自动滚动', 'Auto scroll')}</button>
            <button class="rtlog-btn" type="button" data-act="copy">${L('复制', 'Copy')}</button>
            <button class="rtlog-btn" type="button" data-act="clear">${L('清空', 'Clear')}</button>
            <button class="rtlog-btn" type="button" data-act="close">${L('关闭', 'Close')}</button>
        </div>
    </div>
    <div class="rtlog-list" id="rtLogList" data-level="all"><div class="rtlog-empty">${L('暂无运行日志', 'No runtime logs yet')}</div></div>
</div>`;
        document.body.appendChild(modal);
        listEl = modal.querySelector('#rtLogList');
        countEl = modal.querySelector('.rtlog-count');
        autoBtn = modal.querySelector('[data-act="autoscroll"]');
        syncLevelButtons();
        modal.addEventListener('click', event => {
            if (event.target === modal) close();
        });
        modal.querySelector('.rtlog-tools').addEventListener('click', onToolClick);
        listEl.addEventListener('scroll', () => {
            const atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 24;
            if (state.autoScroll !== atBottom) setAutoScroll(atBottom);
        });
    }

    function syncLevelButtons() {
        if (!modal) return;
        modal.querySelectorAll('[data-level]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.level === state.level);
        });
        listEl?.setAttribute('data-level', state.level);
    }

    function setAutoScroll(next) {
        state.autoScroll = next;
        autoBtn?.classList.toggle('active', next);
    }

    function onToolClick(event) {
        const btn = event.target.closest('button');
        if (!btn) return;
        if (btn.dataset.level) {
            state.level = LEVELS.includes(btn.dataset.level) ? btn.dataset.level : 'all';
            syncLevelButtons();
            return;
        }
        const act = btn.dataset.act;
        if (act === 'autoscroll') {
            setAutoScroll(!state.autoScroll);
            if (state.autoScroll) scrollToBottom();
        } else if (act === 'copy') {
            copyLogs(btn);
        } else if (act === 'clear') {
            clearLogs();
        } else if (act === 'close') {
            close();
        }
    }

    function rowsHtml(entries) {
        return entries.map(entry => {
            const level = ['info', 'warn', 'error'].includes(entry.level) ? entry.level : 'info';
            return `<div class="rtlog-row rtlog-${level}" data-raw="${esc(entry.text)}"><span class="rtlog-time">${timeText(entry.ts)}</span><span class="rtlog-lv">${level.toUpperCase()}</span><span class="rtlog-text">${esc(entry.text)}</span></div>`;
        }).join('');
    }

    function appendEntries(entries) {
        if (!listEl || !entries.length) return;
        const empty = listEl.querySelector('.rtlog-empty');
        if (empty) empty.remove();
        listEl.insertAdjacentHTML('beforeend', rowsHtml(entries));
        state.rows = state.rows.concat(entries);
        if (state.rows.length > MAX_ROWS) {
            const drop = state.rows.length - MAX_ROWS;
            state.rows = state.rows.slice(drop);
            Array.from(listEl.querySelectorAll('.rtlog-row')).slice(0, drop).forEach(row => row.remove());
        }
        if (countEl) countEl.textContent = String(state.rows.length);
        if (state.autoScroll) scrollToBottom();
    }

    function scrollToBottom() {
        if (listEl) listEl.scrollTop = listEl.scrollHeight;
    }

    async function pull(reset) {
        if (reset) {
            state.afterId = 0;
            state.rows = [];
            if (listEl) listEl.innerHTML = `<div class="rtlog-empty">${L('暂无运行日志', 'No runtime logs yet')}</div>`;
            if (countEl) countEl.textContent = '0';
        }
        try {
            const res = await fetch(`/api/logs?after_id=${state.afterId}&limit=${FETCH_LIMIT}`, { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            const lastId = Number(data.last_id);
            if (Number.isFinite(lastId)) state.afterId = lastId;
            appendEntries(Array.isArray(data.logs) ? data.logs : []);
        } catch (e) {
            /* 后端重启/不可用：下一轮自动重试 */
        }
    }

    function stopTimer() {
        if (state.timer) clearInterval(state.timer);
        state.timer = null;
    }

    function open() {
        build();
        modal.classList.add('open');
        state.open = true;
        pull(true).then(() => {
            setAutoScroll(true);
            scrollToBottom();
        });
        stopTimer();
        state.timer = setInterval(() => pull(false), POLL_MS);
    }

    function close() {
        if (modal) modal.classList.remove('open');
        state.open = false;
        stopTimer();
    }

    async function clearLogs() {
        stopTimer();
        try { await fetch('/api/logs', { method: 'DELETE' }); } catch (e) { /* 忽略 */ }
        state.rows = [];
        if (listEl) listEl.innerHTML = `<div class="rtlog-empty">${L('暂无运行日志', 'No runtime logs yet')}</div>`;
        if (countEl) countEl.textContent = '0';
        if (state.open) state.timer = setInterval(() => pull(false), POLL_MS);
    }

    async function copyLogs(btn) {
        const text = state.rows.map(entry => `[${timeText(entry.ts)}] ${entry.text}`).join('\n');
        try {
            await navigator.clipboard.writeText(text);
        } catch (e) {
            const area = document.createElement('textarea');
            area.value = text;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            area.remove();
        }
        const original = btn.textContent;
        btn.textContent = L('已复制', 'Copied');
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => { btn.textContent = original; }, 1200);
    }

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && state.open) close();
    });

    window.RuntimeLog = { open, close };
    window.openRuntimeLogs = open;
    window.closeRuntimeLogs = close;
})();
