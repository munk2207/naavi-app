const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-web-security', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

  page.on('console', msg => console.log('PAGE:', msg.text()));

  const filePath = 'file:///C:/Users/waela/OneDrive/Desktop/Naavi/mynaavi-website/brakes-demo-storyboard.html';
  await page.goto(filePath, { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 4000));

  // Take screenshot before click
  await page.screenshot({ path: 'scripts/debug-before-click.png' });

  const info = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return {
      buttonCount: btns.length,
      buttons: btns.map(b => ({ text: b.textContent.trim().slice(0,40), class: b.className.slice(0,60) })),
      rootHTML: document.querySelector('#root') ? document.querySelector('#root').innerHTML.slice(0, 300) : 'no root'
    };
  });
  console.log(JSON.stringify(info, null, 2));

  // Try clicking first button
  if (info.buttonCount > 0) {
    await page.evaluate(() => document.querySelectorAll('button')[0].click());
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: 'scripts/debug-after-click.png' });
    console.log('Screenshots saved');
  }

  await browser.close();
})().catch(e => console.error(e.message));
