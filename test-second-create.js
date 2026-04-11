const fs = require('fs');
const src = fs.readFileSync('lib/naavi-client.ts', 'utf8');

const startMarker = "return `\n";
const endMarker = "`.trim();";
const startIdx = src.indexOf(startMarker);
const endIdx = src.indexOf(endMarker, startIdx);
let prompt = src.substring(startIdx + startMarker.length, endIdx);

prompt = prompt.replace(/\$\{todayISO\}/g, '2026-04-11');
prompt = prompt.replace(/\$\{nowToronto\}/g, '2026-04-11T19:00:00-04:00');
prompt = prompt.replace(/\$\{upcomingDays\}/g, 'Today = 2026-04-11');
prompt = prompt.replace(/\$\{languageNote\}/g, 'Respond in English.');
prompt = prompt.replace(/\$\{briefContext\}/g, 'No events.');
prompt = prompt.replace(/\$\{healthContext\b[^}]*\}/g, '');
prompt = prompt.replace(/\$\{knowledgeContext\b[^}]*\}/g, '');

// Simulate: first create worked, now history has the SPEECH (not JSON) as assistant response
// This is what the app sends — assistantSpeech is just the speech text
const messages = [
  { role: 'user', content: 'Create a shopping list' },
  { role: 'assistant', content: 'Shopping list created.' },
  { role: 'user', content: 'Create a list called Shopping List 1.' },
];

const payload = JSON.stringify({ system: prompt, messages });
fs.writeFileSync('test-second-create.json', payload);
console.log('Second create payload written');
