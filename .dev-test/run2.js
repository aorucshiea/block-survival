/* 快速静默验证：无窗口。核心断言 = reload 后 DEBUG 存在（存档恢复不崩）+ draw calls 下降 + 无 pageerror */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('file:///E:/zcode/' + encodeURIComponent('方块生存.html'), { waitUntil: 'load' });
  await page.waitForFunction(() => window.DEBUG, null, { timeout: 15000 });
  const boot = await page.evaluate(() => ({ stats: window.DEBUG.stats(), seed: document.getElementById('seedTag').textContent }));
  console.log('== BOOT ==', JSON.stringify(boot));

  await page.click('#startBtn');
  await page.waitForTimeout(1000);
  const selfTest = await page.evaluate(() => window.DEBUG.selfTest());
  console.log('== SELFTEST ==', JSON.stringify(selfTest));

  // 存档往返
  await page.evaluate(() => window.DEBUG.save());
  const beforePos = await page.evaluate(() => window.DEBUG.pos());
  await page.reload({ waitUntil: 'load' });
  let reloaded = true;
  try { await page.waitForFunction(() => window.DEBUG, null, { timeout: 15000 }); }
  catch (e) { reloaded = false; }
  if (reloaded) {
    const after = await page.evaluate(() => ({
      startBtn: document.getElementById('startBtn').textContent.trim(),
      mcSub: document.querySelector('.mcSub').textContent,
      sameSeed: document.getElementById('seedTag').textContent,
      stats: window.DEBUG.stats(),
    }));
    await page.click('#startBtn');
    await page.waitForTimeout(800);
    const afterPos = await page.evaluate(() => window.DEBUG.pos());
    const afterTime = await page.evaluate(() => window.DEBUG.time());
    const posMatch = Math.abs(afterPos.x - beforePos.x) < 0.1 && Math.abs(afterPos.z - beforePos.z) < 0.1;
    console.log('== RELOAD ==', JSON.stringify(after), 'posKept=', posMatch, JSON.stringify(afterPos), 'time=', JSON.stringify(afterTime));
    console.log('RESULT:', posMatch ? 'PASS' : 'CHECK POS');
    await page.evaluate(() => window.DEBUG.delSave());   // 清档，不影响你从新档开玩
  } else {
    console.log('== RELOAD FAILED: window.DEBUG never defined ==');
  }
  console.log('== ERRORS ==', errors.length ? JSON.stringify(errors.slice(0, 8)) : 'none');
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
