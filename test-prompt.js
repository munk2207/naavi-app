const fs = require('fs');
const src = fs.readFileSync('lib/naavi-client.ts', 'utf8');

// Extract the template literal
const startMarker = "return `\n";
const endMarker = "`.trim();";
const startIdx = src.indexOf(startMarker);
const endIdx = src.indexOf(endMarker, startIdx);
if (startIdx === -1 || endIdx === -1) { console.log('NO MATCH'); process.exit(1); }

let prompt = src.substring(startIdx + startMarker.length, endIdx);

// Replace template variables with test values
prompt = prompt.replace(/\$\{todayISO\}/g, '2026-04-11');
prompt = prompt.replace(/\$\{nowToronto\}/g, '2026-04-11T15:00:00-04:00');
prompt = prompt.replace(/\$\{upcomingDays\}/g, 'Today = 2026-04-11');
prompt = prompt.replace(/\$\{languageNote\}/g, 'Respond in English.');
prompt = prompt.replace(/\$\{briefContext\}/g, 'No events.');
prompt = prompt.replace(/\$\{healthContext\b[^}]*\}/g, '');
prompt = prompt.replace(/\$\{knowledgeContext\b[^}]*\}/g, '');

console.log('PROMPT LENGTH:', prompt.length);

// Write the full test payload
const payload = JSON.stringify({
  system: prompt,
  messages: [{ role: 'user', content: 'create a shopping list' }]
});

fs.writeFileSync('test-payload.json', payload);
console.log('Payload written to test-payload.json');
