// 第四轮：偏移多少就卡洞沿？60cm vs 80cm 洞的通过性
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('file:///E:/zcode/方块生存.html');
  await page.waitForTimeout(1500);

  const res = await page.evaluate(() => {
    setState('playing');
    const findSpot = () => {
      let spot = null; const cx = WX >> 1, cz = WZ >> 1;
      for (let r = 0; r < 30 && !spot; r++) for (let x = cx - r; x <= cx + r && !spot; x++) for (let z = cz - r; z <= cz + r && !spot; z++) {
        if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
        const t = topAt(x, z); const id = world[idx(x, t, z)];
        if ((id === 1 || id === 2) && topAt(x + 1, z) === t && topAt(x - 1, z) === t && topAt(x, z + 1) === t && topAt(x, z - 1) === t) spot = { x, z, t };
      }
      return spot;
    };
    const spot = findSpot();
    const carvePit = (margin) => {
      const vi = idx(spot.x, spot.t, spot.z);
      if (!carved.has(vi)) carved.set(vi, { bits: new Uint8Array(SUB * SUB * SUB), n: 0, mesh: null });
      const c = carved.get(vi);
      for (let sx = margin; sx <= SUB - 1 - margin; sx++) for (let sz = margin; sz <= SUB - 1 - margin; sz++)
        for (let sy = 0; sy < SUB; sy++) { const k = subIdx(sx, sy, sz); if (!c.bits[k]) { c.bits[k] = 1; c.n++; } }
      rebuildCarvedMesh(spot.x, spot.t, spot.z);
    };
    const tryDrop = (dx, margin) => {
      P.pos.set(spot.x + 0.5 + dx, spot.t + 1, spot.z + 0.5); P.vel.set(0, 0, 0); P.stance = 0; applyStance();
      carvePit(margin);
      for (let i = 0; i < 120; i++) stepPhysics(1 / 60);
      return +(P.pos.y).toFixed(2);           // spot.t+1 = 站洞沿；spot.t = 掉进去了
    };
    const out = { spot, floor: spot.t, rim: spot.t + 1, rows: {} };
    for (const margin of [0, 1]) {
      const row = {};
      for (const dx of [0, 0.05, 0.1, 0.15, 0.2, 0.3]) row['dx' + dx] = tryDrop(dx, margin);
      out.rows[margin === 0 ? '洞60cm' : '洞80cm'] = row;
    }
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
