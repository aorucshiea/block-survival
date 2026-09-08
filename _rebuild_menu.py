# -*- coding: utf-8 -*-
"""按原版宝开 PvZ 主菜单重构：墓碑石板按钮 + 大树挂牌场景 + 小游戏式选关界面"""
import io, sys

PATH = r"D:\ZcodeProject\植物大战僵尸.html"
src = io.open(PATH, encoding="utf-8").read()
orig_len = len(src)

def replace_between(s, start_marker, end_marker, new_block, keep_end=True):
    i = s.find(start_marker)
    assert i >= 0, "start not found: " + start_marker[:60]
    j = s.find(end_marker, i + len(start_marker))
    assert j >= 0, "end not found: " + end_marker[:60]
    return s[:i] + new_block + (s[j:] if keep_end else s[j + len(end_marker):])

# ============================================================
# A. CSS：去掉面板式菜单样式，换成 原版墓碑/石板/木面板/种子包
# ============================================================
NEW_CSS = r'''/* ============ 原版 PvZ 主菜单：墓碑石板 + 木面板 ============ */
#mainMenu {
    background: transparent; backdrop-filter: none;
    display: block; overflow: hidden; padding: 0;
}
/* 顶部标题（原版 Logo 风格：草绿植物 + 木牌大战 + 石灰僵尸） */
.pvz-title {
    position: absolute; top: 2%; left: 55%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 10px;
    font-family: 'Fredoka', 'Bungee', sans-serif; font-weight: 700;
    user-select: none; pointer-events: none; white-space: nowrap; z-index: 4;
    filter: drop-shadow(0 6px 8px rgba(0,0,0,0.35));
}
.pvz-title .t-plant {
    font-size: 50px; color: #8ecf45; letter-spacing: 4px;
    -webkit-text-stroke: 2.5px #2e5c12; paint-order: stroke fill;
    text-shadow: 0 4px 0 #2e5c12, 0 7px 12px rgba(0,0,0,0.3);
}
.pvz-title .t-vs {
    font-size: 16px; color: #ffe9b0; letter-spacing: 3px;
    background: linear-gradient(180deg, #8a6543, #5d4030);
    border: 2.5px solid #3e2a18; border-radius: 8px; padding: 4px 10px;
    box-shadow: 0 3px 0 #2a1c10, inset 0 1px 0 rgba(255,255,255,0.25);
    transform: rotate(-3deg);
}
.pvz-title .t-zombie {
    font-size: 50px; color: #d8dddf; letter-spacing: 4px;
    -webkit-text-stroke: 2.5px #474d4f; paint-order: stroke fill;
    text-shadow: 0 4px 0 #3a4042, 0 7px 12px rgba(0,0,0,0.3);
}
/* 墓碑（右侧主体） */
.tombstone {
    position: absolute; right: 30px; bottom: 40px;
    width: 352px; z-index: 5;
    background:
        radial-gradient(130% 55% at 50% 0%, rgba(255,255,255,0.15), transparent 55%),
        linear-gradient(168deg, #a9b2b4, #868f91 48%, #6e787a);
    border: 4px solid #4b5456;
    border-radius: 150px 150px 14px 14px;
    box-shadow:
        inset 0 12px 24px rgba(255,255,255,0.16),
        inset 0 -16px 26px rgba(0,0,0,0.32),
        inset 0 0 0 2px rgba(0,0,0,0.08),
        0 16px 32px rgba(0,0,0,0.45);
    padding: 34px 30px 36px;
    display: flex; flex-direction: column; gap: 16px;
}
.tombstone::before {
    content: ''; position: absolute; left: 11%; top: 15%; width: 9px; height: 64px;
    background: linear-gradient(180deg, transparent, rgba(0,0,0,0.26) 30%, rgba(0,0,0,0.26) 70%, transparent);
    transform: rotate(13deg); border-radius: 5px; pointer-events: none;
}
.tombstone::after {
    content: ''; position: absolute; right: 9%; bottom: 12%; width: 8px; height: 52px;
    background: linear-gradient(180deg, transparent, rgba(0,0,0,0.24) 35%, rgba(0,0,0,0.24) 65%, transparent);
    transform: rotate(-15deg); border-radius: 4px; pointer-events: none;
}
.tomb-epitaph {
    text-align: center; font-family: 'Bungee', sans-serif; font-size: 18px;
    color: #596366; letter-spacing: 7px; text-shadow: 0 1px 0 rgba(255,255,255,0.35);
    user-select: none; margin-bottom: -4px;
}
/* 刻在墓碑上的石板按钮（悬停泛红，同原版） */
.stone-plaque {
    font-family: 'Bungee', 'Fredoka', sans-serif; font-weight: 700;
    font-size: 26px; letter-spacing: 8px; text-indent: 8px;
    color: #242b2c;
    background: linear-gradient(172deg, #c3caca, #a0a9ab 55%, #8c9597);
    border: 3px solid #535c5d; border-radius: 10px;
    box-shadow: inset 0 2px 0 rgba(255,255,255,0.45), inset 0 -5px 8px rgba(0,0,0,0.28), 0 5px 10px rgba(0,0,0,0.4);
    padding: 10px 6px 13px; cursor: pointer;
    text-shadow: 0 1px 0 rgba(255,255,255,0.35);
    transition: all 0.15s;
    display: flex; flex-direction: column; align-items: center; gap: 1px;
}
.stone-plaque:hover {
    color: #8e1d12;
    text-shadow: 0 0 14px rgba(255,86,48,0.65);
    transform: scale(1.035) rotate(-0.5deg);
}
.stone-plaque:active { transform: scale(0.98); }
.stone-plaque .sp-sub {
    font-family: 'Fredoka', sans-serif; font-size: 12px; letter-spacing: 2px; text-indent: 2px;
    color: #4a5354; text-shadow: none; font-weight: 600;
}
.stone-plaque:hover .sp-sub { color: #8e1d12; }
/* 主菜单底部：难度/辅助 石条 */
.menu-optbar {
    position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 8px;
    background: linear-gradient(180deg, rgba(52,56,58,0.88), rgba(33,37,39,0.92));
    border: 3px solid #53595b; border-radius: 14px;
    padding: 7px 14px; z-index: 5;
    box-shadow: inset 0 2px 0 rgba(255,255,255,0.12), 0 6px 16px rgba(0,0,0,0.4);
}
.menu-optbar .opt-label { font-size: 12px; color: #b8c0c2; font-weight: 700; letter-spacing: 3px; }
.stone-mini {
    font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 14px;
    letter-spacing: 2px; text-indent: 2px; color: #2c3334;
    background: linear-gradient(180deg, #c3caca, #97a1a3);
    border: 2.5px solid #4d5658; border-radius: 9px;
    padding: 5px 14px; cursor: pointer;
    box-shadow: inset 0 2px 0 rgba(255,255,255,0.4), 0 3px 6px rgba(0,0,0,0.35);
    transition: all 0.15s;
}
.stone-mini:hover { filter: brightness(1.08); transform: translateY(-1px); }
.stone-mini.active {
    background: linear-gradient(180deg, #ffd54f, #ffb300);
    border-color: #8d5600; color: #4e2c00;
    box-shadow: inset 0 2px 0 rgba(255,255,255,0.5), 0 0 14px rgba(255,193,7,0.5);
}
.menu-optbar .toggle-row { background: rgba(0,0,0,0.3); padding: 5px 12px; border-radius: 12px; }
.menu-optbar .toggle-row .t-label { font-size: 12px; }
.menu-hint {
    position: absolute; right: 18px; bottom: 20px;
    font-size: 11px; color: rgba(255,255,255,0.8); text-shadow: 0 1px 2px rgba(0,0,0,0.65);
    z-index: 4; text-align: right; line-height: 1.7; pointer-events: none;
}
/* 选关界面：原版小游戏木面板 + 石板标题 */
#levelSelect { background: rgba(16,26,14,0.45); backdrop-filter: blur(2px); }
.overlay .wood-panel {
    background:
        repeating-linear-gradient(90deg, rgba(60,30,5,0.10) 0 3px, transparent 3px 30px),
        linear-gradient(180deg, #e6b378, #d79d5d 55%, #c18545);
    border: 5px solid #7c4f27; border-radius: 16px;
    box-shadow:
        inset 0 0 0 3px rgba(255,236,200,0.55),
        inset 0 0 46px rgba(110,55,8,0.28),
        0 16px 44px rgba(0,0,0,0.5);
    padding: 14px 22px 14px; margin: auto;
    max-width: 860px; max-height: 97%;
    display: flex; flex-direction: column; align-items: center;
    overflow-y: auto;
}
.stone-banner {
    display: inline-flex; align-items: center; gap: 18px;
    background: linear-gradient(180deg, #b4bcbd, #8e9799 55%, #7b8587);
    border: 3px solid #565f60; border-radius: 12px;
    padding: 6px 36px;
    box-shadow: inset 0 2px 0 rgba(255,255,255,0.4), inset 0 -4px 8px rgba(0,0,0,0.25), 0 5px 12px rgba(0,0,0,0.35);
}
.stone-banner #lsTitle {
    font-family: 'Bungee', sans-serif; font-size: 24px; letter-spacing: 8px; text-indent: 8px; color: #fff;
    text-shadow: 0 2px 0 #2e3536, 0 4px 6px rgba(0,0,0,0.45);
}
.stone-banner .ls-count {
    font-family: 'Fredoka', sans-serif; font-size: 13px; color: #ffd54f; font-weight: 700;
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}
#levelSelect .subtitle {
    font-size: 12px; color: #5d3a1a; font-weight: 700; letter-spacing: 2px;
    margin: 9px 0 0; text-shadow: none; background: none; padding: 0; display: block;
}
/* 关卡卡片：种子包样式（白边+红角标+手写标签） */
.level-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
    margin: 10px 0 12px; width: 100%; max-width: 700px;
}
.level-card {
    position: relative; padding: 6px 6px 8px; cursor: pointer; overflow: hidden;
    background: linear-gradient(180deg, #fdfcf5, #f1eede);
    border: 3px solid #ffffff; outline: 2px solid #8f8c80; border-radius: 12px;
    box-shadow: 0 4px 9px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.9);
    transition: all 0.18s; text-align: center;
}
.level-card:hover { transform: translateY(-4px) rotate(-0.6deg); box-shadow: 0 9px 16px rgba(0,0,0,0.35); }
.level-card.active {
    outline: 3px solid #ffc107;
    box-shadow: 0 0 0 4px rgba(255,193,7,0.45), 0 6px 14px rgba(0,0,0,0.35);
    transform: translateY(-4px);
}
.level-card.locked { filter: grayscale(0.85); opacity: 0.62; cursor: not-allowed; }
.level-card.locked:hover { transform: none; box-shadow: 0 4px 9px rgba(0,0,0,0.28); }
.level-card .pc-ribbon {
    position: absolute; top: -18px; left: -18px; width: 40px; height: 40px;
    transform: rotate(45deg); z-index: 2;
    background: linear-gradient(135deg, #d84b3e, #b03226);
    box-shadow: 0 2px 4px rgba(0,0,0,0.35);
}
.level-card .pc-ribbon.done { background: linear-gradient(135deg, #66bb6a, #2e7d32); }
.level-card .pc-art {
    position: relative; height: 58px; border-radius: 7px;
    display: flex; align-items: center; justify-content: center; font-size: 32px;
    border: 2px solid rgba(255,255,255,0.65);
    box-shadow: inset 0 2px 6px rgba(0,0,0,0.25);
    text-shadow: 0 2px 4px rgba(0,0,0,0.4);
}
.level-card.locked .pc-art::after {
    content: '🔒'; position: absolute; font-size: 26px;
    filter: drop-shadow(0 2px 3px rgba(0,0,0,0.5));
}
.level-card .pc-label {
    font-family: 'Fredoka', sans-serif; font-size: 15px; font-weight: 700;
    color: #33261a; margin-top: 6px; letter-spacing: 1px;
}
.level-card .pc-desc { font-size: 10.5px; color: #6d5a44; line-height: 1.25; margin-top: 1px; min-height: 26px; }
.level-card .lc-stars { font-size: 11px; letter-spacing: 2px; color: #f5a600; }
/* 选关底部按钮 */
.ls-bottom { display: flex; align-items: center; gap: 16px; margin-top: 2px; }
.stone-btn {
    font-family: 'Bungee', 'Fredoka', sans-serif; font-weight: 700; font-size: 16px;
    letter-spacing: 4px; text-indent: 4px; color: #fff;
    text-shadow: 0 2px 0 rgba(0,0,0,0.4);
    background: linear-gradient(180deg, #66bb6a, #2e7d32);
    border: 3px solid #1b4a1e; border-radius: 12px;
    padding: 9px 26px; cursor: pointer;
    box-shadow: inset 0 2px 0 rgba(255,255,255,0.35), 0 4px 0 #143d17, 0 8px 14px rgba(0,0,0,0.35);
    transition: all 0.12s;
}
.stone-btn:hover {
    filter: brightness(1.07); transform: translateY(-2px);
    box-shadow: inset 0 2px 0 rgba(255,255,255,0.35), 0 6px 0 #143d17, 0 10px 18px rgba(0,0,0,0.4);
}
.stone-btn:active { transform: translateY(3px); box-shadow: inset 0 2px 0 rgba(255,255,255,0.35), 0 1px 0 #143d17; }
.stone-btn.back {
    font-size: 13px; padding: 8px 16px; letter-spacing: 2px; text-indent: 0;
    background: linear-gradient(180deg, #a1887f, #6d4c41);
    border-color: #3e2723;
    box-shadow: inset 0 2px 0 rgba(255,255,255,0.25), 0 4px 0 #2a1a12, 0 8px 14px rgba(0,0,0,0.35);
}
/* 结算面板：同一块木板 */
.overlay .menu-panel {
    background:
        repeating-linear-gradient(90deg, rgba(60,30,5,0.10) 0 3px, transparent 3px 30px),
        linear-gradient(180deg, #e6b378, #d79d5d 55%, #c18545);
    border: 5px solid #7c4f27; border-radius: 16px;
    box-shadow:
        inset 0 0 0 3px rgba(255,236,200,0.55),
        inset 0 0 46px rgba(110,55,8,0.28),
        0 16px 44px rgba(0,0,0,0.5);
    padding: 14px 30px 16px; margin: auto;
    max-width: 640px;
    display: flex; flex-direction: column; align-items: center;
}
.overlay .subtitle { font-size: 13px; color: #5d3a1a; margin-bottom: 10px; font-weight: 600; letter-spacing: 2px; text-shadow: none; background: none; padding: 0; }

/* 辅助开关（沿用） */
.toggle-row {
    display: flex; align-items: center; gap: 10px;
    background: rgba(0,0,0,0.25); padding: 6px 14px;
    border-radius: 20px; border: 1px solid rgba(255,255,255,0.12);
    cursor: pointer; transition: background 0.2s;
}
.toggle-row:hover { background: rgba(0,0,0,0.38); }
.toggle-track {
    width: 40px; height: 22px;
    background: rgba(0,0,0,0.4); border-radius: 11px;
    position: relative; transition: background 0.2s;
    border: 2px solid rgba(255,255,255,0.15); flex-shrink: 0;
}
.toggle-track.on { background: rgba(102,187,106,0.4); border-color: #66bb6a; }
.toggle-thumb {
    width: 14px; height: 14px; background: #fff; border-radius: 50%;
    position: absolute; top: 2px; left: 2px; transition: left 0.2s, background 0.2s;
}
.toggle-track.on .toggle-thumb { left: 20px; background: #66bb6a; }
.toggle-row .t-label { font-size: 13px; font-weight: 600; color: #fff; }
.toggle-row .t-hint { font-size: 10px; opacity: 0.5; }

.menu-btn {
    font-family: 'Bungee', sans-serif; font-size: 24px;
    padding: 12px 44px; margin-top: 6px;
    background: linear-gradient(180deg, #ffc107, #ff8f00);
    color: #3e2723; border: none; border-radius: 40px; cursor: pointer;
    box-shadow: 0 5px 0 #e65100, 0 8px 16px rgba(0,0,0,0.4);
    transition: transform 0.1s, box-shadow 0.1s; letter-spacing: 1px;
    text-shadow: 0 1px 0 rgba(255,255,255,0.3);
}
.menu-btn:hover { transform: translateY(-2px); box-shadow: 0 7px 0 #e65100, 0 12px 20px rgba(0,0,0,0.5); }
.menu-btn:active { transform: translateY(3px); box-shadow: 0 2px 0 #e65100; }
.menu-btn.secondary {
    font-size: 16px; padding: 8px 28px; margin-top: 10px;
    background: linear-gradient(180deg, #66bb6a, #2e7d32);
    box-shadow: 0 5px 0 #1b5e20, 0 8px 16px rgba(0,0,0,0.4);
    color: #fff;
}
.menu-btn.secondary:hover { box-shadow: 0 7px 0 #1b5e20, 0 12px 20px rgba(0,0,0,0.5); }
.menu-btn.secondary:active { box-shadow: 0 2px 0 #1b5e20; }

#gameOver .stats {
    background: rgba(62,32,8,0.4); padding: 14px 28px;
    border-radius: 10px; margin-bottom: 12px;
    border: 2px solid rgba(124,79,39,0.65);
}
#gameOver .stats div { font-size: 16px; margin: 4px 0; color: #fff3d6; }
#gameOver .stats strong { color: #ffc107; font-family: 'Bungee', sans-serif; font-size: 20px; }
#gameOver .best {
    font-size: 12px; color: #7a5326; margin-bottom: 14px;
    border-top: 1px solid rgba(124,79,39,0.35); padding-top: 8px; max-width: 320px;
}
#gameOver .best .new-record { color: #c62828; font-weight: 700; animation: recordPulse 1s ease-in-out infinite alternate; }
@keyframes recordPulse { to { text-shadow: 0 0 12px #ffc107; } }
.end-buttons { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; }
'''

src = replace_between(
    src,
    "/* PvZ 木质面板：菜单内容底座 */",
    "#waveBanner {",
    NEW_CSS + "\n",
)

# ============================================================
# B. HTML：mainMenu 改为 墓碑+标题+石条，新增 levelSelect
# ============================================================
NEW_MENU_HTML = r'''    <div class="overlay" id="mainMenu">
        <div class="pvz-title"><span class="t-plant">植物</span><span class="t-vs">大战</span><span class="t-zombie">僵尸</span></div>

        <div class="tombstone">
            <div class="tomb-epitaph">R.I.P.</div>
            <button class="stone-plaque" data-menu="story">冒险模式<span class="sp-sub" id="spSub">第 1 关</span></button>
            <button class="stone-plaque" data-menu="challenge">挑战模式<span class="sp-sub" id="spSubCh">0/4 通关</span></button>
            <button class="stone-plaque" data-menu="endless">无尽模式<span class="sp-sub">生存到底</span></button>
        </div>

        <div class="menu-optbar">
            <span class="opt-label">难度</span>
            <button class="stone-mini" data-diff="easy">简单</button>
            <button class="stone-mini active" data-diff="normal">普通</button>
            <button class="stone-mini" data-diff="hard">困难</button>
            <div class="toggle-row" id="autoSunToggle">
                <div class="toggle-track"><div class="toggle-thumb"></div></div>
                <div class="t-label">自动收阳光</div>
            </div>
        </div>

        <div class="menu-hint">数字键 1-7 选植物 · 空格暂停<br>支持拖拽卡片种植</div>
    </div>

    <div class="overlay" id="levelSelect" style="display:none;">
        <div class="wood-panel">
            <div class="stone-banner"><span id="lsTitle">冒险模式</span><span class="ls-count" id="lsCount"></span></div>
            <p class="subtitle" id="menuSubtitle">主线关卡 · 逐关解锁</p>
            <div class="level-grid" id="levelGrid"></div>
            <div class="ls-bottom">
                <button class="stone-btn back" id="lsBackBtn">◀ 返回</button>
                <button class="stone-btn" id="startBtn">开始闯关 ▶</button>
            </div>
        </div>
    </div>
'''

src = replace_between(
    src,
    '<div class="overlay" id="mainMenu">',
    '<div class="overlay" id="gameOver"',
    NEW_MENU_HTML,
)

# ============================================================
# C. drawMenuScene：复刻原版构图
# ============================================================
NEW_SCENE = r'''// 菜单背景场景：复刻原版宝开PvZ主菜单构图（大树挂牌+白房红顶+墓碑草坪）
let _menuInfoCache = null, _menuInfoAt = 0;
function menuInfo() {
    const now = performance.now();
    if (_menuInfoCache && now - _menuInfoAt < 1000) return _menuInfoCache;
    let cleared = 0;
    try {
        const prog = JSON.parse(localStorage.getItem(PROGRESS_KEY)) || { cleared: [] };
        cleared = prog.cleared.filter(id => LEVELS.some(l => l.id === id)).length;
    } catch (e) {}
    _menuInfoCache = { cleared, total: LEVELS.length };
    _menuInfoAt = now;
    return _menuInfoCache;
}

function drawMenuScene(c) {
    const W = CONFIG.CANVAS_W, H = CONFIG.CANVAS_H;
    const t = performance.now() / 1000;
    function rr(cc, x, y, w2, h2, r) {
        cc.beginPath();
        cc.moveTo(x + r, y);
        cc.arcTo(x + w2, y, x + w2, y + h2, r);
        cc.arcTo(x + w2, y + h2, x, y + h2, r);
        cc.arcTo(x, y + h2, x, y, r);
        cc.arcTo(x, y, x + w2, y, r);
        cc.closePath();
    }

    // ---- 天空 ----
    const sky = c.createLinearGradient(0, 0, 0, 430);
    sky.addColorStop(0, '#2f8fdc');
    sky.addColorStop(0.45, '#69b7e8');
    sky.addColorStop(0.8, '#a9dcf2');
    sky.addColorStop(1, '#dff2d8');
    c.fillStyle = sky;
    c.fillRect(0, 0, W, 430);

    // ---- 云 ----
    function cloud(x, y, s, alpha) {
        c.fillStyle = 'rgba(255,255,255,' + alpha + ')';
        c.beginPath();
        c.arc(x, y, 26 * s, 0, Math.PI * 2);
        c.arc(x + 28 * s, y - 12 * s, 21 * s, 0, Math.PI * 2);
        c.arc(x + 56 * s, y, 26 * s, 0, Math.PI * 2);
        c.arc(x + 28 * s, y + 11 * s, 23 * s, 0, Math.PI * 2);
        c.fill();
    }
    const clouds = [
        { x: 560, y: 80, s: 1.25, v: 7 },
        { x: 900, y: 155, s: 0.9, v: 11 },
        { x: 400, y: 185, s: 0.6, v: 13 },
        { x: 770, y: 52, s: 0.7, v: 9 },
    ];
    for (const cl of clouds) {
        const cx = (cl.x + t * cl.v) % (W + 240) - 120;
        cloud(cx, cl.y, cl.s, 0.92);
    }

    // ---- 远处丘陵 ----
    function hillPath() {
        c.beginPath(); c.moveTo(0, 375);
        for (let x = 0; x <= W; x += 16) {
            const hy2 = 372 - 26 * Math.sin(x * 0.005 + 0.6) - 12 * Math.sin(x * 0.011 + 2.1);
            c.lineTo(x, hy2);
        }
        c.lineTo(W, 440); c.lineTo(0, 440); c.closePath();
    }
    c.fillStyle = '#8fc65a';
    hillPath(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.16)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, 375);
    for (let x = 0; x <= W; x += 16) {
        const hy2 = 372 - 26 * Math.sin(x * 0.005 + 0.6) - 12 * Math.sin(x * 0.011 + 2.1);
        c.lineTo(x, hy2);
    }
    c.stroke();

    // ---- 白房红顶（中景故事书小屋）----
    (function house() {
        const gx = 402, gy = 352;
        c.fillStyle = '#f7f3e6';
        c.fillRect(gx, 272, 168, gy - 272);
        c.fillStyle = '#efe9d8';
        c.fillRect(gx + 168, 298, 86, gy - 298);
        // 主屋顶
        c.fillStyle = '#cd5232';
        c.beginPath();
        c.moveTo(gx - 14, 274); c.lineTo(gx + 84, 226); c.lineTo(gx + 182, 274);
        c.closePath(); c.fill();
        c.fillStyle = '#b8432a';
        c.beginPath();
        c.moveTo(gx - 14, 274); c.lineTo(gx + 84, 226); c.lineTo(gx + 84, 240); c.lineTo(gx + 8, 274);
        c.closePath(); c.fill();
        // 侧翼屋顶
        c.fillStyle = '#c04a2c';
        c.beginPath();
        c.moveTo(gx + 160, 300); c.lineTo(gx + 211, 266); c.lineTo(gx + 262, 300);
        c.closePath(); c.fill();
        // 烟囱 + 烟
        c.fillStyle = '#9c5a3c';
        c.fillRect(gx + 122, 234, 18, 40);
        c.fillStyle = '#7e4630';
        c.fillRect(gx + 120, 232, 22, 6);
        for (let i = 0; i < 3; i++) {
            const px = gx + 131 + Math.sin(t * 0.9 + i * 1.8) * 6;
            const py = 226 - i * 13 - ((t * 5) % 13);
            c.fillStyle = 'rgba(240,240,240,' + (0.32 - i * 0.09) + ')';
            c.beginPath(); c.arc(px, py, 5 + i * 2.6, 0, Math.PI * 2); c.fill();
        }
        // 窗
        function hwin(wx, wy) {
            c.fillStyle = '#41618a';
            c.fillRect(wx, wy, 26, 26);
            c.fillStyle = 'rgba(255,255,255,0.35)';
            c.beginPath(); c.moveTo(wx, wy + 26); c.lineTo(wx + 26, wy); c.lineTo(wx + 16, wy); c.lineTo(wx, wy + 16); c.closePath(); c.fill();
            c.strokeStyle = '#fdfdf8'; c.lineWidth = 2.5;
            c.strokeRect(wx, wy, 26, 26);
            c.beginPath(); c.moveTo(wx + 13, wy); c.lineTo(wx + 13, wy + 26); c.moveTo(wx, wy + 13); c.lineTo(wx + 26, wy + 13); c.stroke();
        }
        hwin(gx + 16, 290); hwin(gx + 58, 290); hwin(gx + 100, 290);
        // 门
        c.fillStyle = '#6d4c41';
        c.beginPath();
        c.moveTo(gx + 212, gy); c.lineTo(gx + 212, 318);
        c.arc(gx + 226, 318, 14, Math.PI, 0);
        c.lineTo(gx + 240, gy); c.closePath(); c.fill();
        c.fillStyle = '#ffd54f';
        c.beginPath(); c.arc(gx + 235, 336, 2.2, 0, Math.PI * 2); c.fill();
        // 房基阴影
        c.fillStyle = 'rgba(0,0,0,0.12)';
        c.fillRect(gx - 6, gy - 4, 262, 5);
    })();

    // ---- 深绿灌木列（栅栏后）----
    for (let bx = 246; bx < W + 30; bx += 34) {
        const br = 16 + ((bx * 7) % 9);
        c.fillStyle = '#2f6b33';
        c.beginPath(); c.arc(bx, 368 - br * 0.35, br, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#3b7d3c';
        c.beginPath(); c.arc(bx - 6, 364 - br * 0.4, br * 0.6, 0, Math.PI * 2); c.fill();
    }

    // ---- 白栅栏 ----
    function picket(x, y, hgt) {
        c.fillStyle = '#fafaf7';
        c.fillRect(x, y, 15, hgt);
        c.fillStyle = '#e4e4de';
        c.fillRect(x + 11, y, 4, hgt);
        c.beginPath();
        c.moveTo(x - 1, y); c.lineTo(x + 7, y - 8); c.lineTo(x + 16, y); c.closePath();
        c.fillStyle = '#fafaf7'; c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.07)'; c.lineWidth = 1;
        c.strokeRect(x, y, 15, hgt);
    }
    for (let x = 244; x < W; x += 25) picket(x, 370, 44);
    c.fillStyle = '#efefe9';
    c.fillRect(244, 382, W - 244, 5);
    c.fillRect(244, 400, W - 244, 5);

    // ---- 草坪（明暗列 + 三叶草）----
    const lawnTop = 414, lawnBot = 556;
    const lawn = c.createLinearGradient(0, lawnTop, 0, lawnBot);
    lawn.addColorStop(0, '#85c053');
    lawn.addColorStop(1, '#6aa944');
    c.fillStyle = lawn;
    c.fillRect(0, lawnTop, W, lawnBot - lawnTop);
    for (let i = 0; i < 10; i++) {
        c.fillStyle = i % 2 ? 'rgba(255,255,255,0.055)' : 'rgba(0,40,0,0.045)';
        c.fillRect(i * 110, lawnTop, 110, lawnBot - lawnTop);
    }
    for (let i = 0; i < 46; i++) {
        const gx = (i * 137 + 41) % W;
        const gy = lawnTop + 8 + (i * 89 + 23) % (lawnBot - lawnTop - 16);
        c.fillStyle = 'rgba(190,230,140,0.5)';
        c.beginPath(); c.arc(gx, gy, 2.1, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(gx + 3.6, gy + 1, 2.1, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(gx + 1.6, gy + 3.6, 2.1, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = 'rgba(30,70,15,0.28)';
    c.fillRect(0, lawnBot - 3, W, 3);

    // ---- 土坡前景 ----
    const dirt = c.createLinearGradient(0, lawnBot, 0, H);
    dirt.addColorStop(0, '#9a6a44');
    dirt.addColorStop(0.4, '#825635');
    dirt.addColorStop(1, '#65422a');
    c.fillStyle = dirt;
    c.fillRect(0, lawnBot, W, H - lawnBot);
    for (let i = 0; i < 90; i++) {
        const dx = (i * 113 + 17) % W;
        const dy = lawnBot + 6 + (i * 53 + 31) % (H - lawnBot - 10);
        c.fillStyle = i % 3 ? 'rgba(60,36,18,0.3)' : 'rgba(220,180,130,0.22)';
        c.fillRect(dx, dy, 3, 2);
    }
    for (let i = 0; i < 7; i++) {
        const sx = 90 + i * 150 + (i * 37) % 40;
        const sy = lawnBot + 24 + (i * 29) % 50;
        c.fillStyle = '#8f8a80';
        c.beginPath(); c.ellipse(sx, sy, 8 + (i % 3) * 3, 5.5 + (i % 2) * 2, 0.2, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.28)';
        c.beginPath(); c.ellipse(sx - 2, sy - 2, 3.4, 2, 0.2, 0, Math.PI * 2); c.fill();
    }
    function tuft(bx, by, s) {
        c.strokeStyle = '#4e9427'; c.lineWidth = 2 * s;
        for (let b = -2; b <= 2; b++) {
            c.beginPath();
            c.moveTo(bx + b * 3 * s, by + 2);
            c.quadraticCurveTo(bx + b * 4.4 * s, by - 7 * s, bx + b * 6 * s, by - 11 * s - Math.abs(b));
            c.stroke();
        }
    }
    for (let i = 0; i < 22; i++) tuft(24 + i * 50 + (i * 31) % 18, lawnBot + 3, 0.85 + (i % 3) * 0.14);

    // ---- 大树（左，挂牌）----
    const trunkG = c.createLinearGradient(30, 0, 165, 0);
    trunkG.addColorStop(0, '#7d5535');
    trunkG.addColorStop(0.55, '#6d4a2f');
    trunkG.addColorStop(1, '#54381f');
    c.fillStyle = trunkG;
    c.beginPath();
    c.moveTo(26, H);
    c.bezierCurveTo(40, 480, 52, 340, 62, 210);
    c.lineTo(128, 218);
    c.bezierCurveTo(122, 350, 130, 500, 148, H);
    c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(26, H); c.lineTo(6, H); c.quadraticCurveTo(40, H - 34, 58, H); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(148, H); c.lineTo(172, H); c.quadraticCurveTo(140, H - 30, 118, H); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(58,38,20,0.5)'; c.lineWidth = 2.5;
    for (let b = 0; b < 3; b++) {
        c.beginPath();
        c.moveTo(50 + b * 26, H - 8);
        c.bezierCurveTo(60 + b * 22, 480, 66 + b * 18, 340, 74 + b * 16, 230);
        c.stroke();
    }
    c.strokeStyle = '#5d3f26'; c.lineWidth = 17; c.lineCap = 'round';
    c.beginPath(); c.moveTo(95, 250); c.quadraticCurveTo(180, 205, 268, 196); c.stroke();
    c.lineWidth = 10;
    c.beginPath(); c.moveTo(90, 300); c.quadraticCurveTo(150, 292, 196, 272); c.stroke();
    c.lineCap = 'butt';
    const crown = [
        [-20, 30, 130, '#2c662c'], [100, -10, 120, '#357835'], [225, 40, 100, '#2c662c'],
        [65, 110, 100, '#38813a'], [195, 130, 82, '#2c662c'], [318, 88, 70, '#357835'],
        [-5, 172, 70, '#2f6e30'], [115, 188, 58, '#2c662c'], [370, 20, 52, '#2f6e30'],
    ];
    for (const [cx2, cy2, cr, cc] of crown) {
        c.fillStyle = cc;
        c.beginPath(); c.arc(cx2, cy2, cr, 0, Math.PI * 2); c.fill();
    }
    for (const [cx2, cy2, cr] of [[-6, 24, 82], [104, -6, 70], [228, 40, 60], [68, 112, 58], [322, 84, 38]]) {
        c.fillStyle = 'rgba(255,255,255,0.09)';
        c.beginPath(); c.arc(cx2 - cr * 0.25, cy2 - cr * 0.3, cr * 0.62, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = 'rgba(20,50,18,0.35)';
    c.beginPath(); c.ellipse(148, 224, 185, 24, 0, 0, Math.PI * 2); c.fill();

    // ---- 树上挂牌 ×2 ----
    function hangSign(x, ropeTopY, plankY, pw, ph, rot, fill, edge, txt, txtCol, fs) {
        c.save();
        c.translate(x, plankY); c.rotate(rot);
        c.strokeStyle = '#caa06a'; c.lineWidth = 3;
        c.beginPath(); c.moveTo(0, -(plankY - ropeTopY)); c.lineTo(0, 0); c.stroke();
        c.fillStyle = fill;
        c.strokeStyle = edge; c.lineWidth = 3;
        rr(c, -pw / 2, 0, pw, ph, 7); c.fill(); c.stroke();
        c.fillStyle = '#3c2a16';
        c.beginPath(); c.arc(-pw / 2 + 9, ph / 2, 2.4, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(pw / 2 - 9, ph / 2, 2.4, 0, Math.PI * 2); c.fill();
        c.fillStyle = txtCol;
        c.font = '700 ' + fs + 'px Fredoka, sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(txt, 0, ph / 2 + 1);
        c.restore();
    }
    const mi = menuInfo();
    hangSign(232, 214, 234, 192, 46, -0.03, '#6d4a2f', '#453018', '欢迎回来！', '#9ee860', 21);
    hangSign(258, 288, 296, 174, 36, 0.025, '#8a6543', '#57402a', '已通关 ' + mi.cleared + ' / ' + mi.total + ' 关', '#ffe9b0', 14);

    // ---- 墓碑基座装饰（DOM墓碑落其上）----
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.beginPath(); c.ellipse(856, 610, 218, 24, 0, 0, Math.PI * 2); c.fill();
    for (let i = 0; i < 9; i++) tuft(668 + i * 46 + (i * 17) % 20, 606, 0.9 + (i % 2) * 0.2);
    function daisy(fx2, fy2) {
        for (let p = 0; p < 6; p++) {
            const pa = p / 6 * Math.PI * 2;
            c.fillStyle = '#fdfdf6';
            c.beginPath(); c.ellipse(fx2 + Math.cos(pa) * 5, fy2 + Math.sin(pa) * 5, 3.6, 2.3, pa, 0, Math.PI * 2); c.fill();
        }
        c.fillStyle = '#ffca28';
        c.beginPath(); c.arc(fx2, fy2, 2.6, 0, Math.PI * 2); c.fill();
    }
    daisy(664, 596); daisy(694, 602); daisy(1042, 598);

    // ---- 金向日葵奖杯（左下）----
    (function trophy() {
        const bx = 118, by = 632;
        const glow = c.createRadialGradient(bx, by - 40, 8, bx, by - 40, 120);
        glow.addColorStop(0, 'rgba(255,220,80,0.4)');
        glow.addColorStop(1, 'rgba(255,220,80,0)');
        c.fillStyle = glow;
        c.beginPath(); c.arc(bx, by - 40, 120, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#c79a1b';
        c.beginPath();
        c.moveTo(bx - 40, by); c.lineTo(bx + 40, by); c.lineTo(bx + 30, by - 14); c.lineTo(bx - 30, by - 14);
        c.closePath(); c.fill();
        c.fillStyle = '#e0b12c';
        c.fillRect(bx - 26, by - 26, 52, 13);
        c.strokeStyle = '#d8a92a'; c.lineWidth = 7;
        c.beginPath(); c.moveTo(bx, by - 26); c.lineTo(bx, by - 52); c.stroke();
        for (let p = 0; p < 12; p++) {
            const pa = p / 12 * Math.PI * 2 + 0.26;
            c.fillStyle = p % 2 ? '#f4c832' : '#ffd94e';
            c.beginPath(); c.ellipse(bx + Math.cos(pa) * 21, by - 72 + Math.sin(pa) * 21, 11, 5.5, pa, 0, Math.PI * 2); c.fill();
        }
        c.fillStyle = '#c7931b';
        c.beginPath(); c.arc(bx, by - 72, 14, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.45)';
        c.beginPath(); c.arc(bx - 4, by - 76, 4.5, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.9)';
        c.font = '700 14px Fredoka';
        c.textAlign = 'left'; c.textBaseline = 'alphabetic';
        c.fillText('✦', bx + 34, by - 96);
        c.fillText('✦', bx - 46, by - 58);
    })();

    // ---- 喷壶 / 图鉴 / 钥匙（中下装饰）----
    (function props() {
        const cx3 = 320, cy3 = 618;
        c.fillStyle = '#2e8b74';
        rr(c, cx3 - 26, cy3 - 30, 52, 40, 8); c.fill();
        c.strokeStyle = '#1f6b58'; c.lineWidth = 5;
        c.beginPath(); c.arc(cx3, cy3 - 32, 13, Math.PI, 0); c.stroke();
        c.fillStyle = '#2e8b74';
        c.beginPath();
        c.moveTo(cx3 + 24, cy3 - 20); c.lineTo(cx3 + 46, cy3 - 34); c.lineTo(cx3 + 49, cy3 - 28); c.lineTo(cx3 + 26, cy3 - 12);
        c.closePath(); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.85)';
        rr(c, cx3 - 18, cy3 - 16, 36, 14, 4); c.fill();
        c.fillStyle = '#1f6b58';
        c.font = '700 9px Fredoka'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('ZEN', cx3, cy3 - 9);
        c.save();
        c.translate(452, 622); c.rotate(-0.08);
        c.fillStyle = '#8a5a30';
        rr(c, -32, -20, 64, 42, 5); c.fill();
        c.fillStyle = '#a97142';
        rr(c, -32, -20, 10, 42, 5); c.fill();
        c.fillStyle = '#e8d9b0';
        c.font = '700 10px Fredoka'; c.textAlign = 'center';
        c.fillText('图 鉴', 4, -2);
        c.fillStyle = '#6d4523';
        c.font = '700 8px Fredoka';
        c.fillText('PVZ', 4, 12);
        c.restore();
        c.strokeStyle = '#d8a92a'; c.lineWidth = 5;
        c.beginPath(); c.arc(556, 620, 8, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.moveTo(564, 620); c.lineTo(588, 620); c.stroke();
        c.beginPath(); c.moveTo(580, 620); c.lineTo(580, 628); c.moveTo(588, 620); c.lineTo(588, 630); c.stroke();
        c.save();
        c.translate(578, 636); c.rotate(0.1);
        c.fillStyle = '#c62828';
        rr(c, -22, -11, 44, 22, 4); c.fill();
        c.fillStyle = '#fff';
        c.font = '700 10px Fredoka'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('SHOP', 0, 1);
        c.restore();
    })();

    // ---- 飘浮阳光粒子 ----
    for (let i = 0; i < 12; i++) {
        const px = (i * 173 + t * 12) % W;
        const py = 170 + (i * 97) % 330 + Math.sin(t + i * 2) * 12;
        c.fillStyle = 'rgba(255, 245, 150,' + (0.22 + 0.18 * Math.sin(t * 2 + i)) + ')';
        c.beginPath(); c.arc(px, py, 2.5, 0, Math.PI * 2); c.fill();
    }

    // ---- 顶部渐晕 ----
    const vg = c.createLinearGradient(0, 0, 0, 64);
    vg.addColorStop(0, 'rgba(0,0,0,0.22)'); vg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = vg;
    c.fillRect(0, 0, W, 64);
}
'''

src = replace_between(
    src,
    "// 菜单背景场景：宝开PvZ风格",
    "function drawHoverCell() {",
    NEW_SCENE + "\n",
)

# ============================================================
# D. buildLevelGrid：种子包卡片
# ============================================================
NEW_GRID = r'''function buildLevelGrid() {
    const grid = document.getElementById('levelGrid');
    grid.innerHTML = '';
    const isStory = menuState.mode === 'story';
    const data = isStory ? LEVELS : CHALLENGES;
    const prog = loadLevelProgress();
    document.getElementById('menuSubtitle').textContent =
        isStory ? '主线关卡 · 通关当前关卡解锁下一关' : '挑战模式 · 全部开放，敢来试试吗';
    document.getElementById('lsTitle').textContent = isStory ? '冒险模式' : '挑战模式';
    document.getElementById('lsCount').textContent =
        prog.cleared.filter(id => data.some(l => l.id === id)).length + ' / ' + data.length + ' 通关';

    data.forEach((lvl, idx) => {
        let isUnlocked = true;
        let isCleared = false;
        if (isStory) {
            isUnlocked = idx === 0 || prog.cleared.includes(data[idx - 1].id);
            isCleared = prog.cleared.includes(lvl.id);
        } else {
            isCleared = prog.cleared.includes(lvl.id);
        }
        if (idx === 0 && !data.find(l => l.id === menuState.selectedLevel)) {
            menuState.selectedLevel = data[0].id;
        }
        const card = document.createElement('div');
        card.className = 'level-card';
        if (!isUnlocked) card.classList.add('locked');
        if (lvl.id === menuState.selectedLevel && isUnlocked) card.classList.add('active');

        const top = lvl.bgTop || '#8bc34a';
        const bot = lvl.bgBottom || '#558b2f';
        const icons = isStory ? ['🌻', '🌙', '🏊', '🏠', '🌫️', '🔥'] : ['⚔️', '🛡️', '黑夜', '💀'];
        const icon = isStory ? (icons[idx] || '🌻') : (icons[idx] || '🏆');
        card.innerHTML = `
            <div class="pc-ribbon ${isCleared ? 'done' : ''}"></div>
            <div class="pc-art" style="background:linear-gradient(180deg,${top},${bot})"><span>${icon}</span></div>
            <div class="pc-label">${lvl.name}</div>
            <div class="pc-desc">${lvl.desc}</div>
            ${isCleared ? '<div class="lc-stars">⭐⭐⭐</div>' : ''}
        `;

        if (isUnlocked) {
            card.addEventListener('click', () => {
                menuState.selectedLevel = lvl.id;
                document.querySelectorAll('.level-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
            });
        }
        grid.appendChild(card);
    });
}

function refreshPlaques() {
    const prog = loadLevelProgress();
    const storyCleared = LEVELS.filter(l => prog.cleared.includes(l.id)).length;
    const sub = document.getElementById('spSub');
    if (storyCleared >= LEVELS.length) {
        sub.textContent = '全关通关！';
    } else {
        let nextIdx = 0;
        while (nextIdx < LEVELS.length && prog.cleared.includes(LEVELS[nextIdx].id)) nextIdx++;
        sub.textContent = '第 ' + (nextIdx + 1) + ' 关 · ' + LEVELS[nextIdx].name;
    }
    const chDone = CHALLENGES.filter(l => prog.cleared.includes(l.id)).length;
    document.getElementById('spSubCh').textContent = chDone + '/' + CHALLENGES.length + ' 通关';
}

function openLevelSelect(mode) {
    menuState.mode = mode;
    const data = mode === 'story' ? LEVELS : CHALLENGES;
    menuState.selectedLevel = data[0].id;
    buildLevelGrid();
    document.getElementById('levelSelect').style.display = 'flex';
    document.getElementById('mainMenu').style.display = 'none';
}

function backToMainMenu() {
    document.getElementById('levelSelect').style.display = 'none';
    document.getElementById('mainMenu').style.display = 'block';
    refreshPlaques();
}
'''

src = replace_between(
    src,
    "function buildLevelGrid() {",
    "\n// ============ HUD ============",
    NEW_GRID,
)

# ============================================================
# E. 事件绑定：石板按钮 / 难度石片 / 选关
# ============================================================
NEW_EVENTS = r'''    // 墓碑石板按钮（原版主菜单交互）
    document.querySelectorAll('.stone-plaque').forEach(btn => {
        btn.addEventListener('click', () => {
            const m = btn.dataset.menu;
            if (m === 'story' || m === 'challenge') openLevelSelect(m);
            else if (m === 'endless') {
                document.getElementById('mainMenu').style.display = 'none';
                startEndless();
            }
        });
    });

    // 难度选择（主菜单底部石条）
    document.querySelectorAll('.stone-mini').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.stone-mini').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            menuState.difficulty = btn.dataset.diff;
        });
    });

    // 自动收取开关
    document.getElementById('autoSunToggle').addEventListener('click', () => {
        menuState.autoSun = !menuState.autoSun;
        document.querySelector('#autoSunToggle .toggle-track').classList.toggle('on', menuState.autoSun);
    });

    // 选关界面
    document.getElementById('startBtn').addEventListener('click', () => {
        document.getElementById('mainMenu').style.display = 'none';
        document.getElementById('levelSelect').style.display = 'none';
        startGame(false);
    });
    document.getElementById('lsBackBtn').addEventListener('click', backToMainMenu);
    document.getElementById('restartBtn').addEventListener('click', () => {
        document.getElementById('gameOver').style.display = 'none';
        document.getElementById('hud').style.display = 'none';
        document.getElementById('progressBar').style.display = 'none';
        document.getElementById('pauseBtn').style.display = 'none';
        backToMainMenu();
    });
    document.getElementById('endlessBtn').addEventListener('click', () => {
        document.getElementById('gameOver').style.display = 'none';
        startEndless();
    });
'''

src = replace_between(
    src,
    "    // 难度选择\n    document.querySelectorAll('.diff-btn')",
    "    dom.pauseBtn.addEventListener('click', togglePause);",
    NEW_EVENTS,
)

# 初始化时刷新墓碑副标题
src = src.replace(
    "buildLevelGrid();\n// 菜单时不生成植物卡片",
    "buildLevelGrid();\nrefreshPlaques();\n// 菜单时不生成植物卡片",
    1,
)

io.open(PATH, "w", encoding="utf-8", newline="\n").write(src)
print("OK, size:", orig_len, "->", len(src))
