const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-web-security', '--allow-file-access-from-files', '--window-size=420,870']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.goto('file:///C:/Users/waela/OneDrive/Desktop/Naavi/mynaavi-website/brakes-demo-storyboard.html', { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 8000));

  // Find all clickable elements
  const info = await page.evaluate(() => {
    const all = document.querySelectorAll('button, [onclick], div[class*="cursor"], svg, circle');
    return Array.from(all).slice(0, 20).map(el => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, class: el.className?.toString().slice(0,50), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
  });
  console.log(JSON.stringify(info, null, 2));

  // Click center of viewport where the big play button should be
  await page.mouse.click(195, 350);
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'scripts/after-center-click.png' });
  console.log('Done');
  await browser.close();
})().catch(e => console.error(e.message));
