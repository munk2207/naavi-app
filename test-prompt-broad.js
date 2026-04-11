const fs = require('fs');
const src = fs.readFileSync('lib/naavi-client.ts', 'utf8');

const startMarker = "return `\n";
const endMarker = "`.trim();";
const startIdx = src.indexOf(startMarker);
const endIdx = src.indexOf(endMarker, startIdx);
let prompt = src.substring(startIdx + startMarker.length, endIdx);

prompt = prompt.replace(/\$\{todayISO\}/g, '2026-04-11');
prompt = prompt.replace(/\$\{nowToronto\}/g, '2026-04-11T15:00:00-04:00');
prompt = prompt.replace(/\$\{upcomingDays\}/g, 'Today = 2026-04-11');
prompt = prompt.replace(/\$\{languageNote\}/g, 'Respond in English.');
prompt = prompt.replace(/\$\{briefContext\}/g, 'No events.');
prompt = prompt.replace(/\$\{healthContext\b[^}]*\}/g, '');
// Simulate knowledge context being injected (isBroadQuery=true fetches all 100 fragments)
prompt = prompt.replace(/\$\{knowledgeContext\b[^}]*\}/g, `

Relevant knowledge about Robert (9 items):
- Robert prefers no highways when driving
- Robert takes metformin every morning
- Robert's daughter is Sarah, email sarah@email.com
- Robert prefers afternoon calls, not morning
- Robert's doctor is Dr. Patel
- Robert's home address is 123 Main Street, Ottawa
- Robert is allergic to shellfish
- Robert's wife is Louise
- Robert prefers Earl Grey tea
`);

// Simulate the isBroadQuery=true message injection
const userContent = `create a shopping list

[These are the EXACT items you must read to Robert one by one — do not say "listed above", copy every single one into your speech field:
- Robert prefers no highways when driving
- Robert takes metformin every morning
- Robert's daughter is Sarah, email sarah@email.com
- Robert prefers afternoon calls, not morning
- Robert's doctor is Dr. Patel
- Robert's home address is 123 Main Street, Ottawa
- Robert is allergic to shellfish
- Robert's wife is Louise
- Robert prefers Earl Grey tea]`;

const payload = JSON.stringify({
  system: prompt,
  messages: [{ role: 'user', content: userContent }]
});

fs.writeFileSync('test-payload-broad.json', payload);
console.log('Broad query payload written');
