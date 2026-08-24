/**
 * simulate-geo-arrival.js — fire a location alert on cue during filming,
 * without physically driving/walking to the place.
 *
 * report-location-event (supabase/functions/report-location-event/index.ts)
 * has several anti-phantom guards that reject a naive "just send the exact
 * center coordinates" simulation:
 *   - far-outside guard: rejects if reported point is > 2x the rule's radius
 *     from center.
 *   - cold-start guard (first-ever event on a rule): rejects if reported
 *     point is < 70% of radius from center — a real first arrival fires at
 *     the boundary, not dead center.
 * This script places the simulated fix at 80% of the rule's radius from its
 * resolved center (safely inside both guards) before POSTing, so it behaves
 * like a real arrival instead of getting silently skipped.
 *
 * Usage:
 *   node scripts/simulate-geo-arrival.js <label-keyword> [arrive|leave]
 *
 * Looks up Robert's most recently created, enabled location rule whose
 * label matches <label-keyword> (case-insensitive substring), computes a
 * boundary-adjacent fix relative to that rule's actual resolved center, and
 * POSTs it to report-location-event on staging — exactly what the phone's
 * background geofence task would have sent.
 *
 * The rule must already exist (created live, e.g. by saying the Demo 1 ask)
 * before this can simulate its arrival — this does not create rules.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const ROBERT_USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847'; // staging, robert.esm.2207@gmail.com

function offsetPoint(lat, lng, distanceM, bearingDeg) {
  const R = 6371000;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const angDist = distanceM / R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) + Math.cos(lat1) * Math.sin(angDist) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angDist) * Math.cos(lat1),
      Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

async function main() {
  const labelKeyword = process.argv[2];
  const directionArg = process.argv[3] || 'arrive';
  if (!labelKeyword) {
    console.error('Usage: node scripts/simulate-geo-arrival.js <label-keyword> [arrive|leave]');
    process.exit(1);
  }

  const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);

  const { data: rules, error } = await sb
    .from('action_rules')
    .select('id, label, trigger_config, enabled')
    .eq('user_id', ROBERT_USER_ID)
    .eq('trigger_type', 'location')
    .eq('enabled', true)
    .ilike('label', `%${labelKeyword}%`)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Rule lookup failed:', error.message);
    process.exit(1);
  }
  if (!rules || rules.length === 0) {
    console.error(
      `No enabled location rule found for Robert with label matching "${labelKeyword}". ` +
      `The rule has to exist first — say the ask live, then run this.`,
    );
    process.exit(1);
  }

  const rule = rules[0];
  const tc = rule.trigger_config || {};
  const centerLat = tc.resolved_lat;
  const centerLng = tc.resolved_lng;
  const radius = typeof tc.radius_meters === 'number' ? tc.radius_meters : 300;

  if (typeof centerLat !== 'number' || typeof centerLng !== 'number') {
    console.error('Rule has no resolved_lat/resolved_lng — cannot simulate. trigger_config:', JSON.stringify(tc));
    process.exit(1);
  }

  const distanceM = radius * 0.8; // inside the 70%-200% safe window
  const { lat: simLat, lng: simLng } = offsetPoint(centerLat, centerLng, distanceM, 0);
  const event = directionArg === 'leave' ? 'exit' : 'enter';

  console.log(`Rule: "${rule.label}" (${rule.id})`);
  console.log(`Center: ${centerLat}, ${centerLng}  Radius: ${radius}m`);
  console.log(`Simulated fix: ${simLat.toFixed(6)}, ${simLng.toFixed(6)}  (${distanceM.toFixed(0)}m from center, event=${event})`);

  const res = await fetch(`${process.env.STAGING_SUPABASE_URL}/functions/v1/report-location-event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      user_id: ROBERT_USER_ID,
      rule_id: rule.id,
      lat: simLat,
      lng: simLng,
      event,
      timestamp: new Date().toISOString(),
    }),
  });
  const json = await res.json();
  console.log('Response:', JSON.stringify(json, null, 2));

  if (json.deferred) {
    console.log(`\nRule has a dwell configured — fan-out won't happen until fire_at (${json.fire_at}). Re-check after that time, or the fire-pending-dwells cron will pick it up.`);
  } else if (json.fired) {
    console.log('\nFired — alert should be landing on the configured channels now.');
  } else if (json.skipped) {
    console.log(`\nSkipped: ${json.skipped} — this usually means the rule already fired recently, or the phantom guards rejected it. If this is unexpected, check the rule's last_entered_at/last_exited_at.`);
  }
}

main();
