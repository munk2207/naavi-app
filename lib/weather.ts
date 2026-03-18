/**
 * Weather integration
 *
 * Primary: Open-Meteo (free, no API key, excellent CORS support)
 * Fallback: wttr.in (also free, no key needed)
 *
 * Open-Meteo is chosen as primary because it has reliable browser CORS headers.
 * wttr.in sometimes redirects, which breaks fetch in browsers.
 */

import type { BriefItem } from './naavi-client';

// Ottawa coordinates
const OPEN_METEO_URL =
  'https://api.open-meteo.com/v1/forecast' +
  '?latitude=45.4215&longitude=-75.6972' +
  '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
  '&wind_speed_unit=kmh&timezone=America%2FToronto';

const WTTR_URL = 'https://wttr.in/Ottawa?format=j1';

// WMO weather code descriptions (subset covering common Ottawa conditions)
const WMO_DESCRIPTIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
};

function wmoDescription(code: number): string {
  return WMO_DESCRIPTIONS[code] ?? 'Variable conditions';
}

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

async function fetchFromOpenMeteo(): Promise<BriefItem> {
  const res = await fetch(OPEN_METEO_URL);
  if (!res.ok) throw new Error(`Open-Meteo responded with ${res.status}`);

  const data = await res.json();
  const c = data.current;
  if (!c) throw new Error('Unexpected response shape from Open-Meteo');

  const temp      = Math.round(c.temperature_2m);
  const feelsLike = Math.round(c.apparent_temperature);
  const windKmh   = Math.round(c.wind_speed_10m);
  const desc      = wmoDescription(c.weather_code ?? 0);

  const title = `${temp > 0 ? '+' : ''}${temp}°C — ${desc}`;

  const details: string[] = [`Feels like ${feelsLike > 0 ? '+' : ''}${feelsLike}°C`];
  if (windKmh > 20) details.push(`Wind ${windKmh} km/h`);
  const icy = icyWarning(temp, desc);
  if (icy) details.push(icy);

  console.log('[Weather] Ottawa (Open-Meteo):', title, details.join(' · '));

  return {
    id: 'weather',
    category: 'weather',
    title,
    detail: details.join(' · '),
    urgent: icy !== null,
  };
}

async function fetchFromWttr(): Promise<BriefItem> {
  const res = await fetch(WTTR_URL);
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

  console.log('[Weather] Ottawa (wttr.in):', title, details.join(' · '));

  return {
    id: 'weather',
    category: 'weather',
    title,
    detail: details.join(' · '),
    urgent: icy !== null,
  };
}

export async function fetchOttawaWeather(): Promise<BriefItem> {
  // Try Open-Meteo first (best browser CORS support)
  try {
    return await fetchFromOpenMeteo();
  } catch (err) {
    console.warn('[Weather] Open-Meteo failed, trying wttr.in:', err);
  }

  // Fall back to wttr.in
  try {
    return await fetchFromWttr();
  } catch (err) {
    console.error('[Weather] Both weather sources failed:', err);
    return {
      id: 'weather',
      category: 'weather',
      title: 'Weather unavailable',
      detail: 'Could not reach weather service',
      urgent: false,
    };
  }
}
