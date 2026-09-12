// 复现两个 bug：1) 空手点一下木头就消失  2) 站坑上掉不下去
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto('file:///E:/zcode/方块生存.html');
  await page.waitForTimeout(1500);

  // 进游戏 + 摆好玩家：站在一块原木前的平地上，正对它
  const setup = await page.evaluate(() => {
    setState('playing');
    // 找一棵树：扫世界里任意原木块，旁边要有能站的地面
    let wood = null;
    for (let y = 8; y < 40 && !wood; y++)
      for (let x = 2; x < WX - 2 && !wood; x++)
        for (let z = 2; z < WZ - 2 && !wood; z++) {
          if (world[idx(x, y, z)] !== 4) continue;
          if (world[idx(x, y + 1, z)] === 4) continue;          // 要树干最顶那格（好瞄准）
          wood = { x, y, z };
        }
    if (!wood) return { ok: false, why: 'no wood' };
    // 玩家站在这格原木旁边 2.5m，眼睛平视它中心
    const tx = wood.x + 0.5, ty = wood.y + 0.5, tz = wood.z + 0.5;
    // 找原木旁边能站的列（topAt）
    const px = wood.x + 2, pz = wood.z;
    const top = topAt(px, pz);
    P.pos.set(px + 0.5, top + 1, pz + 0.5);
    P.vel.set(0, 0, 0); P.yaw = 0; P.pitch = 0; P.stance = 0; applyStance();
    // 朝原木中心看
    const ex = P.pos.x, ey = P.pos.y + P.eyeH, ez = P.pos.z;
    const dx = tx - ex, dy = ty - ey, dz = tz - ez;
    const len = Math.hypot(dx, dy, dz);
    P.pitch = Math.asin(dy / len);
    P.yaw = Math.atan2(-dx / len, -dz / len);
    hands.L = null; hands.R = null;                              // 空手
    return { ok: true, wood, stand: { x: px, y: top, z: pz }, eye: [ex, ey, ez] };
  });
  if (!setup.ok) { console.log('SETUP FAIL', setup); process.exit(1); }
  console.log('setup:', JSON.stringify(setup));

  // —— Bug1：模拟"点一下"= 一帧挖掘 ——
  const bite1 = await page.evaluate(() => {
    _rayReady = false;
    mining.active = true;
    updateMining(1 / 60);                                        // 就一帧（一次单击里游戏最多跑几帧，先看一帧的效果）
    const w = { wood: null, n: 0, mesh: null, inScene: false, worldStill: null };
    for (const [vi, c] of carved) {
      if (world[vi] === 4) { w.wood = vi; w.n = c.n; w.mesh = !!c.mesh;
        w.inScene = c.mesh ? scene.children.includes(c.mesh) : false;
        w.worldStill = world[vi];
        // 再看 mesh 几何体里有没有顶点
        if (c.mesh) w.verts = c.mesh.geometry.attributes.position.count;
      }
    }
    return w;
  });
  console.log('bite1:', JSON.stringify(bite1));
  await page.screenshot({ path: 'E:/zcode/.dev-test/bug1-one-click.png' });

  // 多咬几口（按住 1 秒）看裂纹/剩余体
  const biteMore = await page.evaluate(() => {
    for (let i = 0; i < 60; i++) { _rayReady = false; updateMining(1 / 60); }
    for (const [vi, c] of carved) if (world[vi] === 4)
      return { n: c.n, mesh: !!c.mesh, verts: c.mesh ? c.mesh.geometry.attributes.position.count : 0 };
    return null;
  });
  console.log('biteMore(1s):', JSON.stringify(biteMore));
  await page.screenshot({ path: 'E:/zcode/.dev-test/bug1-hold-1s.png' });

  // —— Bug2：站平地上蹲下往脚下挖，看会不会往下沉 ——
  const pit = await page.evaluate(() => {
    // 找一片平的草地
    let spot = null;
    const cx = WX >> 1, cz = WZ >> 1;
    for (let r = 0; r < 30 && !spot; r++)
      for (let x = cx - r; x <= cx + r && !spot; x++)
        for (let z = cz - r; z <= cz + r && !spot; z++) {
          if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
          const t = topAt(x, z), id = world[idx(x, t, z)];
          if ((id === 1 || id === 2) && topAt(x + 1, z) === t && topAt(x - 1, z) === t && topAt(x, z + 1) === t && topAt(x, z - 1) === t)
            spot = { x, y: t, z, id };
        }
    if (!spot) return { ok: false, why: 'no flat spot' };
    P.pos.set(spot.x + 0.5, spot.y + 1, spot.z + 0.5);
    P.vel.set(0, 0, 0);
    P.stance = 1; applyStance();                                 // 蹲下（松土往下掏要求蹲）
    P.pitch = -1.45;                                             // 差不多垂直往下看
    hands.L = null; hands.R = null;
    const y0 = P.pos.y;
    const trace = [];
    for (let i = 0; i < 900; i++) {                              // 15 秒游戏时间
      _rayReady = false;
      updateMining(1 / 60);
      stepPhysics(1 / 60);
      if (i % 60 === 0) {
        const gy = Math.floor(P.pos.y - 0.01);
        const c = carved.get(idx(spot.x, gy, spot.z));
        trace.push({ t: (i / 60).toFixed(0) + 's', y: +P.pos.y.toFixed(3), blockY: gy, carvedN: c ? c.n : 'none', worldId: world[idx(spot.x, gy, spot.z)] });
      }
      if (P.pos.y < y0 - 2) break;
    }
    return { ok: true, spot, y0, endY: +P.pos.y.toFixed(3), sank: +(y0 - P.pos.y).toFixed(3), trace };
  });
  console.log('pit:', JSON.stringify(pit, null, 1));
  await page.screenshot({ path: 'E:/zcode/.dev-test/bug2-pit.png' });

  console.log('console errors:', errors.length ? errors.slice(0, 8) : 'none');
  await browser.close();
})();
