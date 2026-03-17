/**
 * Weather integration — Open-Meteo
 *
 * Completely free, no API key, no account required.
 * Fetches current conditions for Ottawa and returns a BriefItem
 * ready to drop into the morning brief.
 */

import type { BriefItem } from './naavi-client';

// Ottawa coordinates
const LAT = 45.4215;
const LON = -75.6972;

const URL =
  `https://api.open-meteo.com/v1/forecast` +
  `?latitude=${LAT}&longitude=${LON}` +
  `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation` +
  `&temperature_unit=celsius&wind_speed_unit=kmh&timezone=America%2FToronto`;

// WMO weather codes → human-readable description
function describeCode(code: number): string {
  if (code === 0)              return 'Clear sky';
  if (code <= 2)               return 'Partly cloudy';
  if (code === 3)              return 'Overcast';
  if (code <= 49)              return 'Foggy';
  if (code <= 59)              return 'Light drizzle';
  if (code <= 69)              return 'Rain';
  if (code <= 79)              return 'Snow';
  if (code <= 82)              return 'Rain showers';
  if (code <= 86)              return 'Snow showers';
  if (code <= 99)              return 'Thunderstorm';
  return 'Variable conditions';
}

function icyWarning(temp: number, description: string): string | null {
  const lowerDesc = description.toLowerCase();
  if (temp <= 0 && (lowerDesc.includes('rain') || lowerDesc.includes('drizzle'))) {
    return 'Freezing rain — sidewalks will be icy';
  }
  if (temp <= 2 && lowerDesc.includes('snow')) {
    return 'Sidewalks likely icy — consider yaktrax';
  }
  if (temp <= 0) {
    return 'Below freezing — roads and sidewalks may be icy';
  }
  return null;
}

export async function fetchOttawaWeather(): Promise<BriefItem> {
  try {
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`Weather API error: ${res.status}`);

    const data = await res.json();
    const c = data.current;

    const temp      = Math.round(c.temperature_2m as number);
    const feelsLike = Math.round(c.apparent_temperature as number);
    const windKmh   = Math.round(c.wind_speed_10m as number);
    const code      = c.weather_code as number;
    const description = describeCode(code);

    const title = `${temp > 0 ? '+' : ''}${temp}°C — ${description}`;

    const details: string[] = [`Feels like ${feelsLike > 0 ? '+' : ''}${feelsLike}°C`];
    if (windKmh > 20) details.push(`Wind ${windKmh} km/h`);
    const icy = icyWarning(temp, description);
    if (icy) details.push(icy);

    return {
      id: 'weather',
      category: 'weather',
      title,
      detail: details.join(' · '),
      urgent: icy !== null,
    };
  } catch (err) {
    console.warn('[Weather] Failed to fetch — using fallback:', err);
    return {
      id: 'weather',
      category: 'weather',
      title: 'Weather unavailable',
      detail: 'Could not reach weather service',
      urgent: false,
    };
  }
}
