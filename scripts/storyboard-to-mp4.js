/**
 * storyboard-to-mp4.js
 * Converts MyNaavi HTML storyboards to MP4 using Puppeteer + ffmpeg.
 *
 * Usage: node scripts/storyboard-to-mp4.js [storyboard-name]
 * Example: node scripts/storyboard-to-mp4.js brakes
 * Or all:  node scripts/storyboard-to-mp4.js all
 */

const puppeteer = require('puppeteer');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const FFMPEG = 'C:\\Users\\waela\\OneDrive\\ffmpeg\\bin\\ffmpeg.exe';
const WEBSITE_DIR = path.join(__dirname, '..', 'mynaavi-website');
const OUTPUT_DIR = path.join(__dirname, '..', 'storyboard-videos');

const STORYBOARDS = {
  brakes:       { file: 'brakes-demo-storyboard.html',       duration: 32000, title: 'Brakes' },
  doctor:       { file: 'doctor-demo-storyboard.html',       duration: 45000, title: 'Doctor' },
  granddaughter:{ file: 'granddaughter-demo-storyboard.html',duration: 38000, title: 'Granddaughter' },
  insurance:    { file: 'insurance-demo-storyboard.html',    duration: 42000, title: 'Insurance' },
  notes:        { file: 'notes-demo-storyboard.html',        duration: 62000, title: 'Notes' },
};

async function recordStoryboard(name, config) {
  const framesDir = path.join(OUTPUT_DIR, `frames-${name}`);
  const outputMp4 = path.join(OUTPUT_DIR, `mynaavi-${name}.mp4`);

  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`\n📹 Recording: ${config.title} storyboard...`);

  const browser = await puppeteer.launch({
    headless: false,  // must be visible for React timers + animations to run
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--allow-file-access-from-files',
      '--autoplay-policy=no-user-gesture-required',
      '--window-position=0,0',
      '--window-size=420,870',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

  // Load local file
  const filePath = `file://${path.join(WEBSITE_DIR, config.file).replace(/\\/g, '/')}`;
  await page.goto(filePath, { waitUntil: 'networkidle0', timeout: 15000 });

  // Wait for React + Babel to compile — needs ~6s but must NOT let animation auto-start
  // The click at 195,350 starts the animation — do it just before capture begins
  await new Promise(r => setTimeout(r, 7000));

  // Click to start — then immediately begin capturing (no extra wait)
  console.log('  → Clicking play button...');
  await page.mouse.click(195, 350);
  // Small wait just for first frame to render
  await new Promise(r => setTimeout(r, 200));

  // Verify it's playing
  const state = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.map(b => b.textContent.trim()).join(',');
  });
  console.log(`  → Buttons after tap: ${state}`);

  // Capture frames at 24fps
  const FPS = 24;
  const FRAME_INTERVAL = Math.round(1000 / FPS);
  const totalFrames = Math.round(config.duration / FRAME_INTERVAL);

  console.log(`  → Capturing ${totalFrames} frames at ${FPS}fps (${config.duration/1000}s)...`);

  for (let i = 0; i < totalFrames; i++) {
    const framePath = path.join(framesDir, `frame-${String(i).padStart(5, '0')}.png`);
    await page.screenshot({ path: framePath });
    if (i % 24 === 0) process.stdout.write(`  → Frame ${i}/${totalFrames}\r`);
    await new Promise(r => setTimeout(r, FRAME_INTERVAL));
  }

  await browser.close();
  console.log(`\n  → Encoding to MP4...`);

  // Encode frames to MP4 with ffmpeg
  execSync(
    `"${FFMPEG}" -y -framerate ${FPS} -i "${framesDir}\\frame-%05d.png" ` +
    `-c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -movflags +faststart ` +
    `"${outputMp4}"`,
    { stdio: 'inherit' }
  );

  // Clean up frames
  fs.rmSync(framesDir, { recursive: true, force: true });

  console.log(`  ✅ Saved: ${outputMp4}`);
  return outputMp4;
}

async function main() {
  const arg = process.argv[2] || 'all';
  const toRun = arg === 'all' ? Object.keys(STORYBOARDS) : [arg];

  console.log(`🎬 MyNaavi Storyboard → MP4 Converter`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  for (const name of toRun) {
    if (!STORYBOARDS[name]) {
      console.error(`Unknown storyboard: ${name}. Options: ${Object.keys(STORYBOARDS).join(', ')}`);
      continue;
    }
    await recordStoryboard(name, STORYBOARDS[name]);
  }

  console.log('\n🎉 Done!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
