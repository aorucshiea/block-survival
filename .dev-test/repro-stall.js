// 诊断挖井停滞：85s 时挖掘系统内部状态（chip 目标/wellFloor/aimTip/体力）
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
    const out = {};

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

    D.setMine(true);
    let lastBitten = -1, stallStart = -1;
    for (let f = 0; f < 100 * 60; f++) {
      pin();
      update(1 / 60);
      // 总咬掉格数（全 carved）
      let total = 0; for (const [, c] of carved) total += c.n;
      if (total !== lastBitten) { lastBitten = total; stallStart = -1; }
      else if (stallStart < 0) stallStart = f;
      // 停滞 3 秒后打快照
      if (stallStart > 0 && f - stallStart === 180) {
        const gp = groundAimPoint();
        const fl = gp ? wellFloor(gp.x, gp.z) : null;
        const c7 = carved.get(idx(spot.x, spot.t, spot.z));
        const c6 = carved.get(idx(spot.x, spot.t - 1, spot.z));
        out.stall = {
          atSec: +(f / 60).toFixed(1),
          totalBitten: total,
          stam: Math.round(P.stam), exhausted: !!P.exhausted,
          mineState: { active: mining.active, hasTarget: mining.hasTarget, x: mining.x, y: mining.y, z: mining.z, chipT: +(mining.chipT || 0).toFixed(2) },
          viewDirY: +viewDir().y.toFixed(2),
          groundAim: gp ? { x: +gp.x.toFixed(2), z: +gp.z.toFixed(2) } : null,
          wellFloor: fl ? { y: fl.y, sy: fl.sy } : null,
          carvedT: c7 ? c7.n : 0,
          carvedT1: c6 ? c6.n : 0,
          aimTip: document.getElementById('aimTip').textContent,
          digModeLabel: digMode().label
        };
        break;
      }
    }
    D.setMine(false);
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
