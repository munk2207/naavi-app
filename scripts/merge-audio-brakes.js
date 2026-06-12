/**
 * merge-audio-brakes.js
 * Builds the mixed audio track for brakes storyboard and merges with video.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const FFMPEG   = 'C:\\Users\\waela\\OneDrive\\ffmpeg\\bin\\ffmpeg.exe';
const AUDIO    = 'C:\\Users\\waela\\OneDrive\\Desktop\\Naavi\\mynaavi-website\\audio';
const VIDEOS   = 'C:\\Users\\waela\\OneDrive\\Desktop\\Naavi\\storyboard-videos';

// Audio clips with their start time in milliseconds
const CLIPS = [
  { file: `${AUDIO}\\robert\\brakes-ask.mp3`,    startMs: 2900  },
  { file: `${AUDIO}\\naavi\\brakes-answer.mp3`,  startMs: 7700  },
  { file: `${AUDIO}\\robert\\brakes-email.mp3`,  startMs: 14300 },
  { file: `${AUDIO}\\naavi\\brakes-sent.mp3`,    startMs: 17500 },
  { file: `${AUDIO}\\naavi\\brakes-booked.mp3`,  startMs: 20900 },
];

const VIDEO_IN  = `${VIDEOS}\\mynaavi-brakes.mp4`;
const AUDIO_OUT = `${VIDEOS}\\brakes-audio.mp3`;
const VIDEO_OUT = `${VIDEOS}\\mynaavi-brakes-final.mp4`;
const TOTAL_MS  = 32000;

console.log('🎵 Building audio track for Brakes storyboard...');

// Build ffmpeg filter_complex to mix all clips at their correct offsets
// Each clip is delayed by its startMs using adelay filter
const inputs = CLIPS.map(c => `-i "${c.file}"`).join(' ');
const delays = CLIPS.map((c, i) => `[${i}]adelay=${c.startMs}|${c.startMs}[a${i}]`).join('; ');
const mixInputs = CLIPS.map((_, i) => `[a${i}]`).join('');
const filterComplex = `${delays}; ${mixInputs}amix=inputs=${CLIPS.length}:normalize=0[aout]`;

// Generate mixed audio track
console.log('  → Mixing audio clips...');
execSync(
  `"${FFMPEG}" -y ${inputs} -filter_complex "${filterComplex}" -map "[aout]" -t ${TOTAL_MS/1000} "${AUDIO_OUT}"`,
  { stdio: 'inherit' }
);

// Merge audio with video
console.log('  → Merging audio with video...');
execSync(
  `"${FFMPEG}" -y -i "${VIDEO_IN}" -i "${AUDIO_OUT}" -c:v copy -c:a aac -shortest "${VIDEO_OUT}"`,
  { stdio: 'inherit' }
);

// Clean up temp audio
fs.unlinkSync(AUDIO_OUT);

console.log(`\n✅ Done! Saved: ${VIDEO_OUT}`);
