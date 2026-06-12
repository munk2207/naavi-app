// Shrinks icon-preview.png to 75% centered on a pure black canvas
// so the brain doesn't fill the entire icon area on-device.
const sharp = require('sharp');
const path = require('path');

const SRC  = path.join(__dirname, '..', 'assets', 'icon.png');
const OUT1 = path.join(__dirname, '..', 'assets', 'icon.png');
const OUT2 = path.join(__dirname, '..', 'assets', 'adaptive-icon.png');
const PREVIEW = path.join(__dirname, '..', 'assets', 'icon-draft.png');
const SCALE = 0.75;

async function run() {
  const { width, height } = await sharp(SRC).metadata();
  const newW = Math.round(width * SCALE);
  const newH = Math.round(height * SCALE);
  const left = Math.round((width - newW) / 2);
  const top  = Math.round((height - newH) / 2);

  const resized = await sharp(SRC).resize(newW, newH).toBuffer();

  const result = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } }
  })
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer();

  await sharp(result).toFile(PREVIEW);
  await sharp(result).toFile(OUT1);
  await sharp(result).toFile(OUT2);

  console.log(`Done — brain at ${SCALE*100}% (${newW}x${newH}) on ${width}x${height} black canvas`);
}

run().catch(e => { console.error(e); process.exit(1); });
