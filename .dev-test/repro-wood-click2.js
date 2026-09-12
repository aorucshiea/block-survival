// 复现 v2：先验证瞄准命中再挖——分别测 树干单击/按住、30cm木板小方块单击
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

    // ========== 场景 A：树干（整块原木）==========
    // 找一棵树干
    let tree = null; const cx = WX >> 1, cz = WZ >> 1;
    for (let r = 2; r < 40 && !tree; r++) for (let x = cx - r; x <= cx + r && !tree; x++) for (let z = cz - r; z <= cz + r && !tree; z++) {
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
      for (let y = 10; y < 24; y++) if (world[idx(x, y, z)] === 4) { tree = { x, y, z }; break; }
    }
    if (!tree) return { error: '找不到树' };
    // 玩家放到树旁 2m，与树干中段齐平
    const px = tree.x + 0.5 + 2.0, pz = tree.z + 0.5;
    const groundY = topAt(Math.floor(px), Math.floor(pz));
    D.setPos(px, groundY + 1.0, pz); P.vel.set(0, 0, 0);
    for (let i = 0; i < 30; i++) update(1 / 60);   // 让物理稳定（可能掉到地面）
    const aimAt = (tx, ty, tz) => {
      const e = { x: P.pos.x, y: P.pos.y + P.eyeH, z: P.pos.z };
      const d = { x: tx - e.x, y: ty - e.y, z: tz - e.z };
      const l = Math.hypot(d.x, d.y, d.z);
      D.look(Math.atan2(-d.x / l, -d.z / l), Math.asin(d.y / l));
    };
    aimAt(tree.x + 0.5, P.pos.y + P.eyeH, tree.z + 0.5);   // 平视树干
    const ray0 = rayAny();
    out.aimCheckA = { ray: ray0 && ray0.type === 'vox' ? { x: ray0.x, y: ray0.y, z: ray0.z, id: world[idx(ray0.x, ray0.y, ray0.z)] } : ray0 && ray0.type };
    // 目标块 = 实际命中的块（必须是原木才继续）
    const tgt = ray0 && ray0.type === 'vox' ? { x: ray0.x, y: ray0.y, z: ray0.z } : null;
    if (!tgt || world[idx(tgt.x, tgt.y, tgt.z)] !== 4) { out.error = '瞄到的不是原木: ' + JSON.stringify(out.aimCheckA); return out; }

    // A1: 单击 0.15s
    D.setMine(true); for (let i = 0; i < 9; i++) update(1 / 60); D.setMine(false); update(1 / 60);
    out.click1 = { block: world[idx(tgt.x, tgt.y, tgt.z)], carved: D.carvedInfo(tgt.x, tgt.y, tgt.z) };

    // A2: 再按住 4s 看节奏
    D.setMine(true);
    out.hold = [];
    for (let i = 0; i < 240; i++) {
      update(1 / 60);
      if (i % 40 === 39) out.hold.push({ t: +((i + 1) / 60).toFixed(1), block: world[idx(tgt.x, tgt.y, tgt.z)], carved: D.carvedInfo(tgt.x, tgt.y, tgt.z) });
    }
    D.setMine(false);
    out.afterHold = { block: world[idx(tgt.x, tgt.y, tgt.z)], carved: D.carvedInfo(tgt.x, tgt.y, tgt.z) };

    // ========== 场景 B：30cm 木板小方块 ==========
    // 找块平地，放 30cm 木板，站 1.2m 外平视它
    const bx = Math.floor(P.pos.x) + 2, bz = Math.floor(P.pos.z);
    const by = topAt(bx, bz) + 1;
    addSmallBlock(bx, by, bz, 0.3, 6);
    aimAt(bx + 0.15, by + 0.15, bz + 0.15);
    const rayB = rayAny();
    out.aimCheckB = rayB ? (rayB.type === 'sub'
      ? { type: 'sub', mat: rayB.obj.mat, s: rayB.obj.sx, pos: [rayB.obj.x, rayB.obj.y, rayB.obj.z] }
      : { type: 'vox', x: rayB.x, y: rayB.y, z: rayB.z, id: world[idx(rayB.x, rayB.y, rayB.z)] }) : null;
    if (rayB && rayB.type === 'sub') {
      const target = rayB.obj;
      out.subClick = [];
      // B1: 单击 0.15s
      D.setMine(true); for (let i = 0; i < 9; i++) update(1 / 60); D.setMine(false); update(1 / 60);
      out.subAfterClick = { subCount: D.sub().count, stillThere: subVox.includes(target) };
      // B2: 按住 2.5s
      D.setMine(true);
      for (let i = 0; i < 150; i++) {
        update(1 / 60);
        if (i % 25 === 24) out.subClick.push({ t: +((i + 1) / 60).toFixed(1), stillThere: subVox.includes(target), mine: D.mineState(), subObj: mining.subObj === target });
      }
      D.setMine(false);
      out.subAfterHold = { subCount: D.sub().count, stillThere: subVox.includes(target) };
    }
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})();
