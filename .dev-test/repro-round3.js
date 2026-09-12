// 第三轮：T3 加探针（y 轨迹 / 地点 / 洞内子格状态）
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('file:///E:/zcode/方块生存.html');
  await page.waitForTimeout(1500);

  const t3 = await page.evaluate(() => {
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
    const carvePit = (px, pz, gy, margin) => {
      const vi = idx(px, gy, pz);
      if (!world[vi]) return;
      if (!carved.has(vi)) carved.set(vi, { bits: new Uint8Array(SUB * SUB * SUB), n: 0, mesh: null });
      const c = carved.get(vi);
      for (let sx = margin; sx <= SUB - 1 - margin; sx++) for (let sz = margin; sz <= SUB - 1 - margin; sz++)
        for (let sy = 0; sy < SUB; sy++) { const k = subIdx(sx, sy, sz); if (!c.bits[k]) { c.bits[k] = 1; c.n++; } }
      rebuildCarvedMesh(px, gy, pz);
    };
    const out = { spots: [], runs: [] };
    const dropTest = (margin, label) => {
      const spot = findSpot();
      out.spots.push(label + ': ' + JSON.stringify(spot));
      P.pos.set(spot.x + 0.5, spot.t + 1, spot.z + 0.5); P.vel.set(0, 0, 0); P.stance = 0; applyStance();
      carvePit(spot.x, spot.z, spot.t, margin);
      const y0 = P.pos.y, trace = [];
      for (let i = 0; i < 180; i++) {
        stepPhysics(1 / 60);
        if (i % 15 === 0) trace.push(+(P.pos.y).toFixed(2));
      }
      out.runs.push({ label, y0, endY: +P.pos.y.toFixed(3), fell: P.pos.y < y0 - 0.5, trace });
    };
    dropTest(0, '洞60cm=身宽');
    dropTest(1, '洞80cm');
    // 直接换个思路：同一个洞，先 60 再扩到 80，人在洞正上方落下
    const s = findSpot();
    out.spots.push('third spot: ' + JSON.stringify(s));
    return out;
  });
  console.log(JSON.stringify(t3, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
