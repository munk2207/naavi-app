const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-web-security', '--allow-file-access-from-files', '--window-size=420,870']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const filePath = 'file:///C:/Users/waela/OneDrive/Desktop/Naavi/mynaavi-website/brakes-demo-storyboard.html';
  await page.goto(filePath, { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 8000));

  // Get button bounding box
  const btn = await page.$('button');
  const box = btn ? await btn.boundingBox() : null;
  console.log('Button bounding box:', JSON.stringify(box));

  // Take screenshot to confirm position
  await page.screenshot({ path: 'scripts/button-position.png' });

  // Now click using mouse at center of button
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    console.log(`Clicking at ${cx}, ${cy}`);
    await page.mouse.click(cx, cy);
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: 'scripts/after-click.png' });
  }

  await browser.close();
})().catch(e => console.error(e.message));
