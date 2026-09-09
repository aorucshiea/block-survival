// 端到端验证 v2：平地瞄前方 1.5m 挖井 → 走过去掉进去；小方块；全套 selfTest
// 固定种子：无存档时 SEED=Math.random()，每次加载都是新世界——E2E 选点/性能测量/挖掘行为全在漂移，
// flaky 不是回归。预写 {v:1, seed} 骨架锁死世界（bootSave 只取 seed，其余字段由首次 saveGame 补全）
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.addInitScript(() => localStorage.setItem('bx_save_v1', JSON.stringify({ v: 1, seed: 20260909 })));
  await page.goto('file:///E:/zcode/方块生存.html');
  await page.waitForTimeout(1500);

  // —— E2E1：站着瞄前方地面挖井，走过去掉进去 ——
  const e2e = await page.evaluate(() => {
    setState('playing');
    let spot = null; const cx = WX >> 1, cz = WZ >> 1;
    for (let r = 0; r < 40 && !spot; r++) for (let x = cx - r; x <= cx + r && !spot; x++) for (let z = cz - r; z <= cz + r && !spot; z++) {
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
      const t = topAt(x, z);
      let flat = true;
      for (let ddx = -2; ddx <= 2 && flat; ddx++) for (let ddz = -2; ddz <= 2; ddz++)
        if (topAt(x + ddx, z + ddz) !== t) { flat = false; break; }
      if (flat) spot = { x, z, t };
    }
    if (!spot) return { ok: false, why: 'no flat 5x5' };
    const wellX = spot.x + 0.5, wellZ = spot.z + 0.5 - 1.5;      // 面前 1.5m
    P.pos.set(spot.x + 0.5, spot.t + 1, spot.z + 0.5); P.vel.set(0, 0, 0);
    P.stance = 0; applyStance(); hands.L = null; hands.R = null;
    const ex = P.pos.x, ey = P.pos.y + P.eyeH, ez = P.pos.z;
    const dx = wellX - ex, dy = (spot.t + 0.5) - ey, dz = wellZ - ez, len = Math.hypot(dx, dy, dz);
    P.yaw = Math.atan2(-dx / len, -dz / len); P.pitch = Math.asin(dy / len);
    _rayReady = false;
    const hit = frameRay();
    if (!hit || hit.type !== 'vox') return { ok: false, why: 'no vox hit', hit };
    const hb = { x: hit.x, y: hit.y, z: hit.z };                 // 实际命中的块=井位
    mining.active = true;
    for (let i = 0; i < 2400; i++) { _rayReady = false; updateMining(1 / 60); stepPhysics(1 / 60); }
    mining.active = false;
    // 井深：从命中块顶往下数连续整层清空（60cm 井心范围 4..6 子格）。
    // 注意整块挖空的路径：块全空 → world[vi]=0 且 carved 记录删除——沙地软 40s 能挖穿 2 整块，
    // 只数 carved 会把挖成的井量成 0。空气块=100cm 全清，两者都算
    const startGroundY = spot.t + 1;                 // 挖掘前玩家站的地面（E2E 起点即参照）
    let depthCm = 0;
    for (let y = hb.y; y > hb.y - 3; y--) {
      if (world[idx(hb.x, y, hb.z)] === 0) { depthCm += 100; continue; }   // 整块挖空
      const c = carved.get(idx(hb.x, y, hb.z));
      if (!c) break;
      for (let sy = SUB - 1; sy >= 0; sy--) {
        let rowClear = true;
        for (let sx = 3; sx <= 6; sx++) for (let sz = 3; sz <= 6; sz++) if (isSubSolid(c, sx, sy, sz)) rowClear = false;
        if (rowClear) depthCm += 10; else break;
      }
    }
    // 掉落判定：玩家此刻可能已经在井底（挖掘 40s 里跟着下沉），"走过去掉下去"的 y0 参照
    // 必须用挖掘前的地面——已经掉下去过也算掉下去过
    const fell = P.pos.y < startGroundY - 0.5;
    keys['KeyW'] = true;
    for (let i = 0; i < 300; i++) {
      stepPhysics(1 / 60);
      if (P.pos.z < wellZ - 1.5) break;
    }
    keys['KeyW'] = false;
    return { ok: true, spot, hb, depthCm, fell, groundY: startGroundY, endY: +P.pos.y.toFixed(2), walkedTo: +P.pos.z.toFixed(2), stanceNote: '全程站立未蹲' };
  });
  console.log('E2E 挖井走过去:', JSON.stringify(e2e));
  await page.screenshot({ path: 'E:/zcode/.dev-test/e2e-pit-walk.png' });

  // —— E2E2：小方块 ——
  const sub = await page.evaluate(() => {
    const spot = { x: Math.floor(P.pos.x), z: Math.floor(P.pos.z) };
    const top = topAt(spot.x, spot.z);
    const sv0 = subVox.length;
    addSmallBlock(spot.x + 0.2, top + 1 + 0.5, spot.z + 0.2, 0.3, 4);
    const o = subVox[sv0];
    const ex = P.pos.x, ey = P.pos.y + P.eyeH, ez = P.pos.z;
    const dx = o.x + 0.15 - ex, dy = o.y + 0.15 - ey, dz = o.z + 0.15 - ez, len = Math.hypot(dx, dy, dz);
    P.pitch = Math.asin(dy / len); P.yaw = Math.atan2(-dx / len, -dz / len);
    mining.active = true;
    _rayReady = false; updateMining(1 / 60);
    const stillThereAfterClick = subVox.includes(o);
    let t = 0;
    for (; t < 5; t += 1 / 60) { _rayReady = false; updateMining(1 / 60); if (!subVox.includes(o)) break; }
    mining.active = false; resetMining();
    return { stillThereAfterClick, brokeAfterSec: +t.toFixed(2) };
  });
  console.log('E2E 小方块:', JSON.stringify(sub));

  // —— 全套 selfTest ——
  const st = await page.evaluate(() => {
    const r = DEBUG.selfTest();
    return { summary: r.summary, log: r.log };
  });
  console.log('selfTest:', st.summary, st.log.length ? ' FAILURES: ' + st.log.join('；') : '');
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
