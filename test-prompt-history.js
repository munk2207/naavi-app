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
prompt = prompt.replace(/\$\{knowledgeContext\b[^}]*\}/g, '');

// Simulate conversation history where a shopping list was previously created
const messages = [
  { role: 'user', content: 'create a shopping list' },
  { role: 'assistant', content: '{"speech": "Shopping list created.", "actions": [{"type": "LIST_CREATE", "name": "Shopping List", "category": "shopping"}], "pendingThreads": []}' },
  { role: 'user', content: 'add milk, eggs, and bread to my shopping list' },
  { role: 'assistant', content: '{"speech": "Added milk, eggs, and bread to your shopping list.", "actions": [{"type": "LIST_ADD", "listName": "Shopping List", "items": ["milk", "eggs", "bread"]}], "pendingThreads": []}' },
  { role: 'user', content: 'what\'s on my shopping list' },
  { role: 'assistant', content: '{"speech": "Checking your shopping list.", "actions": [{"type": "LIST_READ", "listName": "Shopping List"}], "pendingThreads": []}' },
  { role: 'user', content: 'remove eggs from my shopping list' },
  { role: 'assistant', content: '{"speech": "Removed eggs from your shopping list.", "actions": [{"type": "LIST_REMOVE", "listName": "Shopping List", "items": ["eggs"]}], "pendingThreads": []}' },
  // Now user says create again (after deleting from Drive)
  { role: 'user', content: 'create a shopping list' },
];

const payload = JSON.stringify({ system: prompt, messages });
fs.writeFileSync('test-payload-history.json', payload);
console.log('History payload written');
