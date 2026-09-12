// 第二轮：1) 干净视线点树干  2) 点小方块（疑凶）  3) 洞宽=身宽 → 卡洞沿验证
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('file:///E:/zcode/方块生存.html');
  await page.waitForTimeout(1500);

  // —— 测试1：树干底部（上方还有树干=底部格），从 1.5m 平视瞄它 ——
  const t1 = await page.evaluate(() => {
    setState('playing');
    let wood = null;
    for (let y = 6; y < 40 && !wood; y++)
      for (let x = 3; x < WX - 3 && !wood; x++)
        for (let z = 3; z < WZ - 3 && !wood; z++) {
          if (world[idx(x, y, z)] !== 4 || world[idx(x, y + 1, z)] !== 4) continue;   // 底部树干
          if (world[idx(x, y + 2, z)] !== 4) continue;                                // 至少3格高，叶子在更上面
          const gx = x + 2, gz = z;                                                    // 站在旁边 2m
          const top = topAt(gx, gz);
          if (Math.abs(top - (y - 1)) > 0) continue;                                   // 地面和树基同层
          wood = { x, y, z, gx, gz, top };
        }
    if (!wood) return { ok: false };
    P.pos.set(wood.gx + 0.5, wood.top + 1, wood.gz + 0.5);
    P.vel.set(0, 0, 0); P.stance = 0; applyStance();
    const ex = P.pos.x, ey = P.pos.y + P.eyeH, ez = P.pos.z;
    const tx = wood.x + 0.5, ty = wood.y + 0.5, tz = wood.z + 0.5;
    const dx = tx - ex, dy = ty - ey, dz = tz - ez, len = Math.hypot(dx, dy, dz);
    P.pitch = Math.asin(dy / len); P.yaw = Math.atan2(-dx / len, -dz / len);
    hands.L = null; hands.R = null;
    // 先确认射线真的打到这块木头
    _rayReady = false;
    const hit = frameRay();
    const rayOk = hit && hit.type === 'vox' && hit.x === wood.x && hit.y === wood.y && hit.z === wood.z;
    // 单击一帧
    mining.active = true; _rayReady = false;
    updateMining(1 / 60);
    let carvedInfo = null;
    for (const [vi, c] of carved) if (world[vi] === 4)
      carvedInfo = { n: c.n, mesh: !!c.mesh, verts: c.mesh ? c.mesh.geometry.attributes.position.count : 0 };
    return { ok: true, wood, rayHit: hit ? { type: hit.type, x: hit.x, y: hit.y, z: hit.z } : null, rayOk, carvedInfo };
  });
  console.log('T1 树干单击:', JSON.stringify(t1));
  await page.screenshot({ path: 'E:/zcode/.dev-test/t1-trunk-click.png' });

  // —— 测试2：小方块单击 ——
  const t2 = await page.evaluate(() => {
    // 在眼前 1.5m 放一个 30cm 木板小方块
    const top = topAt(Math.floor(P.pos.x), Math.floor(P.pos.z));
    const fx = P.pos.x - 1.5, fz = P.pos.z;                       // 朝 -x 看（刚才是 -x 方向）
    addSmallBlock(fx, P.pos.y + 1.0, fz, 0.3, 6);                 // 木板小方块
    const before = subVox.length;
    // 瞄它
    const ex = P.pos.x, ey = P.pos.y + P.eyeH, ez = P.pos.z;
    const dx = fx + 0.15 - ex, dy = P.pos.y + 1.15 - ey, dz = fz + 0.15 - ez, len = Math.hypot(dx, dy, dz);
    P.pitch = Math.asin(dy / len); P.yaw = Math.atan2(-dx / len, -dz / len);
    _rayReady = false;
    const hit = frameRay();
    mining.active = true; _rayReady = false;
    updateMining(1 / 60);                                         // 一帧
    return { before, after: subVox.length, rayType: hit ? hit.type : null, instantGone: subVox.length === before - 1 };
  });
  console.log('T2 小方块单击:', JSON.stringify(t2));

  // —— 测试3：洞=身体宽（60cm）人走上去掉不掉；加 10cm 余量掉不掉 ——
  const t3 = await page.evaluate(() => {
    const out = {};
    const mkPit = (margin) => {                                   // 在脚下位置掏 1m 深竖井，margin=往外多掏的子格数
      const px = Math.floor(P.pos.x), pz = Math.floor(P.pos.z);
      const gy = Math.floor(P.pos.y - 0.01);                      // 脚下这层
      const sx0 = margin, sx1 = SUB - 1 - margin, sz0 = margin, sz1 = SUB - 1 - margin;
      for (let y = gy; y > gy - 1; y--) {                         // 只掏一层(1m)就够测
        const vi = idx(px, y, pz);
        if (!world[vi]) continue;
        if (!carved.has(vi)) carved.set(vi, { bits: new Uint8Array(SUB * SUB * SUB), n: 0, mesh: null });
        const c = carved.get(vi);
        for (let sx = sx0; sx <= sx1; sx++) for (let sz = sz0; sz <= sz1; sz++)
          for (let sy = 0; sy < SUB; sy++) { const k = subIdx(sx, sy, sz); if (!c.bits[k]) { c.bits[k] = 1; c.n++; } }
        if (c.n >= SUB * SUB * SUB) finishBreak(px, y, pz, world[vi], 0);
        else rebuildCarvedMesh(px, y, pz);
      }
      return { px, pz, gy };
    };
    const dropTest = (margin) => {
      // 找平地重置
      let spot = null; const cx = WX >> 1, cz = WZ >> 1;
      for (let r = 0; r < 30 && !spot; r++) for (let x = cx - r; x <= cx + r && !spot; x++) for (let z = cz - r; z <= cz + r && !spot; z++) {
        if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
        const t = topAt(x, z); const id = world[idx(x, t, z)];
        if ((id === 1 || id === 2) && topAt(x + 1, z) === t && topAt(x - 1, z) === t && topAt(x, z + 1) === t && topAt(x, z - 1) === t) spot = { x, z, t };
      }
      P.pos.set(spot.x + 0.5, spot.t + 1, spot.z + 0.5); P.vel.set(0, 0, 0); P.stance = 0; applyStance();
      mkPit(margin);
      const y0 = P.pos.y;
      for (let i = 0; i < 120; i++) stepPhysics(1 / 60);          // 2 秒
      return +P.pos.y.toFixed(3);
    };
    out.exactWidth_endY = dropTest(0);        // 洞 60cm（现 smartFootChip 行为）
    out.withMargin_endY = dropTest(1);        // 洞 80cm
    out.groundY_note = '起始 y = 地面+1；结束 y < 起始-0.9 = 掉进去了';
    return out;
  });
  console.log('T3 洞宽测试:', JSON.stringify(t3));

  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
