/**
 * Weather integration — wttr.in
 *
 * Completely free, no API key, no account required.
 * wttr.in is a well-known public weather service with
 * reliable browser CORS support.
 *
 * Fetches current conditions for Ottawa and returns a BriefItem
 * ready to drop into the morning brief.
 */

import type { BriefItem } from './naavi-client';

const URL = 'https://wttr.in/Ottawa?format=j1';

function icyWarning(tempC: number, desc: string): string | null {
  const d = desc.toLowerCase();
  if (tempC <= 0 && (d.includes('rain') || d.includes('drizzle') || d.includes('sleet'))) {
    return 'Freezing rain — sidewalks will be icy';
  }
  if (tempC <= 2 && (d.includes('snow') || d.includes('blizzard'))) {
    return 'Sidewalks likely icy — consider yaktrax';
  }
  if (tempC <= 0) {
    return 'Below freezing — roads and sidewalks may be icy';
  }
  return null;
}

export async function fetchOttawaWeather(): Promise<BriefItem> {
  try {
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`wttr.in responded with ${res.status}`);

    const data = await res.json();
    const c = data.current_condition?.[0];
    if (!c) throw new Error('Unexpected response shape from wttr.in');

    const temp      = parseInt(c.temp_C, 10);
    const feelsLike = parseInt(c.FeelsLikeC, 10);
    const windKmh   = parseInt(c.windspeedKmph, 10);
    const desc      = c.weatherDesc?.[0]?.value ?? 'Variable conditions';

    const title = `${temp > 0 ? '+' : ''}${temp}°C — ${desc}`;

    const details: string[] = [`Feels like ${feelsLike > 0 ? '+' : ''}${feelsLike}°C`];
    if (windKmh > 20) details.push(`Wind ${windKmh} km/h`);
    const icy = icyWarning(temp, desc);
    if (icy) details.push(icy);

    console.log('[Weather] Ottawa:', title, details.join(' · '));

    return {
      id: 'weather',
      category: 'weather',
      title,
      detail: details.join(' · '),
      urgent: icy !== null,
    };
  } catch (err) {
    console.error('[Weather] Fetch failed:', err);
    return {
      id: 'weather',
      category: 'weather',
      title: 'Weather unavailable',
      detail: 'Could not reach weather service',
      urgent: false,
    };
  }
}
