/* 方块生存 v1.0 实机自检：加载游戏 → 收集报错 → 跑 DEBUG.selfTest → 存档往返 → 截图 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const url = 'file:///E:/zcode/' + encodeURIComponent('方块生存.html');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const boot = await page.evaluate(() => ({
    version: window.DEBUG.version,
    state: window.DEBUG.state(),
    seed: document.getElementById('seedTag').textContent,
    stats: window.DEBUG.stats(),
    time: window.DEBUG.time(),
    startBtn: document.getElementById('startBtn').textContent.trim(),
  }));
  console.log('== BOOT ==', JSON.stringify(boot));

  // 进入游戏
  await page.click('#startBtn');
  await page.waitForTimeout(1200);

  // 白天截图
  await page.evaluate(() => { window.DEBUG.setTime(0.3); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, 'shot_day.png') });

  // 自检电池
  const selfTest = await page.evaluate(() => window.DEBUG.selfTest());
  console.log('== SELFTEST ==', JSON.stringify(selfTest));

  // 夜晚 + 火把 + 怪物截图：在脚边一格放火把（等价 place() 落点：世界格 + 注册表）
  await page.evaluate(() => {
    window.DEBUG.setTime(0.75);
    const p = window.DEBUG.pos();
    const gx = Math.floor(p.x) + 1, gz = Math.floor(p.z);
    let y = Math.floor(p.y) + 2;
    while (window.DEBUG.block(gx, y, gz) === 0 && y > 0) y--;
    setBlockAndRebuild(gx, y + 1, gz, 22);
    registerTorch(gx, y + 1, gz);
    torchPlaced++;
    window.DEBUG.spawnMob(p.x + 6, p.z);
    window.DEBUG.look(Math.PI * 0.25, -0.05);
    window.DEBUG.giveTorch(4);
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(__dirname, 'shot_night.png') });

  const nightInfo = await page.evaluate(() => ({
    time: window.DEBUG.time(),
    fires: window.DEBUG.fires(),
    mobs: window.DEBUG.mobs(),
    env: window.DEBUG.env(),
    stats: window.DEBUG.stats(),
    vitals: window.DEBUG.vitals(),
  }));
  console.log('== NIGHT ==', JSON.stringify(nightInfo));

  // 存档往返：保存 → 刷新 → 世界/玩家还在
  const saveInfo = await page.evaluate(() => window.DEBUG.save());
  console.log('== SAVE ==', JSON.stringify(saveInfo));
  const beforePos = await page.evaluate(() => window.DEBUG.pos());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({
    startBtn: document.getElementById('startBtn').textContent.trim(),
    mcSub: document.querySelector('.mcSub').textContent,
    seed: document.getElementById('seedTag').textContent,
    state: window.DEBUG.state(),
  }));
  console.log('== RELOAD ==', JSON.stringify(after), 'posBefore=', JSON.stringify(beforePos));
  await page.click('#startBtn');
  await page.waitForTimeout(800);
  const afterPos = await page.evaluate(() => window.DEBUG.pos());
  const afterTime = await page.evaluate(() => window.DEBUG.time());
  const afterStats = await page.evaluate(() => window.DEBUG.stats());
  console.log('== RELOAD POS ==', JSON.stringify(afterPos), 'time=', JSON.stringify(afterTime), 'sameSeed=', after.seed === boot.seed, 'stats=', JSON.stringify(afterStats));

  // 重载后（继续世界）截图
  await page.screenshot({ path: path.join(__dirname, 'shot_reload.png') });

  // 清理存档（不影响下次测试）
  await page.evaluate(() => window.DEBUG.delSave());

  console.log('== ERRORS ==', errors.length ? JSON.stringify(errors.slice(0, 10)) : 'none');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
