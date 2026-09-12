// 诊断 v2：150s 挖井，每秒记录咬掉总量；捕捉停滞点 dump 全状态
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('file:///E:/zcode/方块生存.html');
  await page.waitForTimeout(1500);

  const res = await page.evaluate(() => {
    const D = window.DEBUG;
    setState('playing');
    const out = { perSec: [], stallDumps: [] };

    let spot = null; const cx = WX >> 1, cz = WZ >> 1;
    outer:
    for (let r = 0; r < 40; r++) for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
      const t = topAt(x, z);
      if (t < 5) continue;
      const id = world[idx(x, t, z)];
      if (id !== 1 && id !== 2) continue;
      let flat = true;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (topAt(x + dx, z + dz) !== t) flat = false;
      if (flat) { spot = { x, z, t }; break outer; }
    }
    if (!spot) return { error: 'no spot' };
    out.spot = spot;
    out.groundId = world[idx(spot.x, spot.t, spot.z)];
    out.belowId = world[idx(spot.x, spot.t - 1, spot.z)];
    out.below2Id = world[idx(spot.x, spot.t - 2, spot.z)];

    const px = spot.x + 0.5, pz = spot.z + 0.5 - 0.8, py = spot.t + 1;
    const pitCx = spot.x + 0.5, pitCz = spot.z + 0.5;
    const pin = () => {
      P.pos.set(px, py, pz); P.vel.set(0, 0, 0); P.onGround = true;
      const e = { x: px, y: py + P.eyeH, z: pz };
      const d = { x: pitCx - e.x, y: spot.t - e.y, z: pitCz - e.z };
      const l = Math.hypot(d.x, d.y, d.z);
      P.yaw = Math.atan2(-d.x / l, -d.z / l); P.pitch = Math.asin(d.y / l);
    };
    pin();

    const totalBitten = () => { let n = 0; for (const [, c] of carved) n += c.n; return n; };

    D.setMine(true);
    let lastTotal = -1, stallFrames = 0, dumped = 0;
    for (let f = 0; f < 150 * 60; f++) {
      pin();
      update(1 / 60);
      if ((f + 1) % 60 === 0) {
        const tot = totalBitten();
        out.perSec.push({ s: Math.round((f + 1) / 60), bitten: tot, y: +P.pos.y.toFixed(2), stam: Math.round(P.stam) });
      }
      // 停滞检测：2 秒无新咬口 → dump（最多 3 次）
      const tot2 = f % 10 === 0 ? totalBitten() : lastTotal;
      if (tot2 === lastTotal) { stallFrames = tot2 === lastTotal ? stallFrames + 1 : 0; } else stallFrames = 0;
      lastTotal = tot2;
      if (stallFrames >= 120 && dumped < 3) {
        dumped++;
        const gp = groundAimPoint();
        const fl = gp ? wellFloor(gp.x, gp.z) : null;
        out.stallDumps.push({
          atSec: +(f / 60).toFixed(1),
          total: lastTotal,
          mine: { active: mining.active, hasTarget: mining.hasTarget, tgt: [mining.x, mining.y, mining.z], chipT: +(mining.chipT || 0).toFixed(2), subObj: !!mining.subObj },
          stam: Math.round(P.stam), ex: !!P.exhausted,
          viewY: +viewDir().y.toFixed(3),
          gp: gp ? [+gp.x.toFixed(2), +gp.z.toFixed(2)] : null,
          wf: fl ? { y: fl.y, sy: fl.sy } : null,
          tip: document.getElementById('aimTip').textContent,
          tgtBlockId: (mining.hasTarget && mining.y > 0) ? world[idx(mining.x, mining.y, mining.z)] : null
        });
        stallFrames = 0;
      }
    }
    D.setMine(false);
    return out;
  });
  // perSec 每秒太长，抽样输出
  if (res.perSec) {
    res.perSecSummary = res.perSec.filter((_, i) => i % 10 === 9 || i < 5);
    delete res.perSec;
  }
  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
