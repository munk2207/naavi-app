/**
 * Generates /audio/discover/start.mp3 using Deepgram Andromeda (brand voice).
 * Run once, then delete the API key.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DEEPGRAM_KEY = process.argv[2];
if (!DEEPGRAM_KEY) { console.error('Usage: node gen-start-audio.js <deepgram-key>'); process.exit(1); }

const VOICE = 'aura-2-andromeda-en';

const CHUNKS = [
`Get MyNaavi working in about five minutes. Here's the full setup, step by step.

Step 1. Download MyNaavi. Open the Google Play Store on your Android phone, search for MyNaavi, and tap Install.

Step 2. Sign in with your Google account. Tap Sign in with Google and pick your usual account. MyNaavi works on top of Google Calendar, Gmail, Contacts, and Drive. Signing in lets it check your schedule, send messages, and save things you ask it to remember, without you switching apps.

Step 3. Allow notifications. Tap Allow when Android asks. Notifications are how MyNaavi gets your attention: a call when you arrive somewhere, a text reminder, a quiet alert. Without permission, MyNaavi can't reach you.

Step 4. Allow location, all the time. When Android asks about location, choose Allow all the time. MyNaavi only knows you've arrived somewhere if location is allowed while the app is in the background. MyNaavi never stores a history of where you've been. If your phone ever revokes this permission, a red banner appears the next time you open the app. One tap re-arms your alerts.

Step 5. Allow physical activity. Tap Allow when Android asks if MyNaavi can track physical activity. Location alerts work by detecting when your phone transitions from moving to still, so MyNaavi knows you've arrived, not just passed through. Android's Motion system is what detects that transition. This data never leaves your phone.`,

`Step 6. Tell MyNaavi your first name. In Settings, under Your name, type your first name. MyNaavi greets you by name on phone calls and signs every outgoing message, so the people you message see your name, not MyNaavi.

Step 7. Add your home and work address. In Settings, under Home address and Work address, type your real addresses. Once set, you can say "home" or "office" instead of the full address every time.

Step 8. Add backup phone numbers. Optional. In Settings, under Phone numbers, add any other numbers you might call MyNaavi from: your spouse's mobile, a work line, a home landline. MyNaavi recognizes you by the phone you're calling from, so extra numbers mean it knows you even when you're not on your own phone.

Step 9. Set a four-digit PIN. Recommended. In Settings, under Voice PIN, set a memorable four-digit number. If MyNaavi doesn't recognize the phone you're calling from, it asks for your PIN first. Three wrong attempts and the call ends.

Step 10. Pick your alert channels. Optional. In Settings, under Alert channels, choose which channels MyNaavi uses: text message, WhatsApp, email, push notification, or voice call. All five are on by default. Turn off the ones you don't want, but keep at least one on.

Step 11. Try your first command. Tap the microphone and say: Hi MyNaavi, what's on my calendar today? MyNaavi reads your day back out loud. That's it, you're set up. From here on, you talk to MyNaavi the way you'd talk to a person.`
];

function callDeeepgram(text, voice, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text });
    const options = {
      hostname: 'api.deepgram.com',
      path: `/v1/speak?model=${voice}`,
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let err = '';
        res.on('data', (d) => err += d);
        res.on('end', () => reject(new Error(`Deepgram ${res.statusCode}: ${err}`)));
        return;
      }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  const parts = [];
  for (let i = 0; i < CHUNKS.length; i++) {
    const chunk = CHUNKS[i].trim();
    console.log(`Chunk ${i + 1}/${CHUNKS.length}: ${chunk.length} chars`);
    const audio = await callDeeepgram(chunk, VOICE, DEEPGRAM_KEY);
    parts.push(audio);
  }
  const combined = Buffer.concat(parts);
  const outPath = path.join(__dirname, '../mynaavi-website/audio/discover/start.mp3');
  fs.writeFileSync(outPath, combined);
  console.log(`Saved to ${outPath} (${(combined.length / 1024).toFixed(0)} KB)`);
})().catch(err => { console.error(err); process.exit(1); });
