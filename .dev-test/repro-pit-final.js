// 最终验证：平面钉住、y 自由——低头 55° 持续挖井，看几秒能掉下去、掉多深
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
    const out = { timeline: [] };

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
    // 地下分层（判断能挖多深才到石头）
    out.layers = [];
    for (let y = spot.t; y > spot.t - 5; y--) out.layers.push({ y, id: world[idx(spot.x, y, spot.z)] });

    const px = spot.x + 0.5, pz = spot.z + 0.5 - 0.8;
    const yawToPit = Math.atan2(-(spot.x + 0.5 - px), -(spot.z + 0.5 - pz));
    // 只钉平面 + 视角（低头 55° 看井口），y 完全交给物理
    const pin = () => {
      P.pos.x = px; P.pos.z = pz; P.vel.x = 0; P.vel.z = 0;
      P.yaw = yawToPit; P.pitch = -0.95;
    };
    P.pos.set(px, spot.t + 1.02, pz); P.vel.set(0, 0, 0);

    const totalBitten = () => { let n = 0; for (const [, c] of carved) n += c.n; return n; };
    const startY = spot.t + 1;

    D.setMine(true);
    let droppedAt = null, droppedTo = null;
    for (let f = 0; f < 120 * 60; f++) {
      pin();
      update(1 / 60);
      if (P.pos.y < startY - 0.5 && droppedAt === null) { droppedAt = +(f / 60).toFixed(1); droppedTo = +P.pos.y.toFixed(2); }
      if ((f + 1) % (10 * 60) === 0) {
        out.timeline.push({
          t: Math.round((f + 1) / 60) + 's',
          y: +P.pos.y.toFixed(2), depth: +(startY - P.pos.y).toFixed(2),
          bitten: totalBitten(), stam: Math.round(P.stam),
          onGround: P.onGround
        });
      }
    }
    D.setMine(false);
    out.droppedAt = droppedAt;
    out.finalY = +P.pos.y.toFixed(2);
    out.startY = startY;
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
