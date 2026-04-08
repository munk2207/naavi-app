/**
 * Naavi — Weather Adapter (Open-Meteo)
 *
 * Open-Meteo is a free, open-source weather API backed by Environment Canada
 * data for Canadian locations. No API key required. No cost. No vendor lock-in.
 *
 * This adapter fetches today + 3-day forecast for Ottawa and computes a
 * `relevance_reason` for each day based on Robert's profile (walks, golf, etc.)
 *
 * Sync frequency: every 60 minutes
 * Stale threshold: 90 minutes
 * Auth: none
 */

import { BaseAdapter, type LocalDB, type SyncResult, type TokenStore } from './base-adapter';
import type { CognitiveProfile } from '../../schema/cognitive-profile';
import type {
  NormalisedDayWeather,
  NormalisedWeatherSummary,
  WeatherCondition,
} from '../../schema/integrations';

// ─────────────────────────────────────────────────────────────────────────────
// OPEN-METEO API TYPES (abbreviated)
// ─────────────────────────────────────────────────────────────────────────────

interface OpenMeteoResponse {
  current: {
    temperature_2m: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
    uv_index_max: number[];
  };
}

// WMO Weather Codes → our WeatherCondition
// https://open-meteo.com/en/docs#weathervariables
const WMO_CODE_MAP: Record<number, WeatherCondition> = {
  0:  'clear',
  1:  'clear',
  2:  'partly_cloudy',
  3:  'cloudy',
  45: 'fog',
  48: 'fog',
  51: 'rain',
  53: 'rain',
  55: 'rain',
  61: 'rain',
  63: 'rain',
  65: 'heavy_rain',
  66: 'freezing_rain',
  67: 'freezing_rain',
  71: 'snow',
  73: 'snow',
  75: 'snow',
  77: 'snow',
  80: 'rain',
  81: 'rain',
  82: 'heavy_rain',
  85: 'snow',
  86: 'snow',
  95: 'thunderstorm',
  96: 'thunderstorm',
  99: 'thunderstorm',
};

// Ottawa coordinates — no live GPS tracking needed
const OTTAWA_LAT = 45.4215;
const OTTAWA_LON = -75.6972;

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER
// ─────────────────────────────────────────────────────────────────────────────

export class WeatherAdapter extends BaseAdapter {
  private profile: CognitiveProfile;

  constructor(db: LocalDB, tokenStore: TokenStore, profile: CognitiveProfile) {
    super('weather', db, tokenStore, 90);
    this.profile = profile;
  }

  async connect(): Promise<boolean> {
    // No auth needed — weather is always "connected"
    await this.updateStatus('connected');
    return true;
  }

  async sync(): Promise<SyncResult> {
    try {
      const raw = await this.fetchFromOpenMeteo();
      const summary = this.normalise(raw);
      await this.db.set('weather_summary', 'current', summary);
      await this.updateStatus('connected');
      return this.successfulSync(summary.forecast.length + 1);
    } catch (err) {
      await this.updateStatus('stale', 'Weather sync failed');
      return this.failedSync(
        this.buildSyncError('network', String(err), true)
      );
    }
  }

  async read(): Promise<NormalisedWeatherSummary | null> {
    return await this.db.get('weather_summary', 'current') as NormalisedWeatherSummary | null;
  }

  // ── Private: fetch from Open-Meteo ───────────────────────────────────────

  private async fetchFromOpenMeteo(): Promise<OpenMeteoResponse> {
    const params = new URLSearchParams({
      latitude:  String(OTTAWA_LAT),
      longitude: String(OTTAWA_LON),
      current:   'temperature_2m,weather_code,wind_speed_10m',
      daily:     'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max',
      forecast_days: '4',
      timezone:  'America/Toronto',
    });

    const response = await fetch(`${OPEN_METEO_URL}?${params}`);
    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status}`);
    }
    return response.json() as Promise<OpenMeteoResponse>;
  }

  // ── Private: normalise Open-Meteo response ────────────────────────────────

  private normalise(raw: OpenMeteoResponse): NormalisedWeatherSummary {
    const today = new Date().toISOString().split('T')[0];
    const cachedAt = new Date().toISOString();

    const days: NormalisedDayWeather[] = raw.daily.time.map((date, i) => {
      const condition = WMO_CODE_MAP[raw.daily.weather_code[i]] ?? 'cloudy';
      const isToday = date === today;

      return {
        date,
        condition,
        temp_high_celsius: Math.round(raw.daily.temperature_2m_max[i]),
        temp_low_celsius:  Math.round(raw.daily.temperature_2m_min[i]),
        current_temp_celsius: isToday
          ? Math.round(raw.current.temperature_2m)
          : Math.round((raw.daily.temperature_2m_max[i] + raw.daily.temperature_2m_min[i]) / 2),
        precipitation_chance: raw.daily.precipitation_probability_max[i],
        wind_speed_kph: isToday ? Math.round(raw.current.wind_speed_10m) : undefined,
        uv_index: raw.daily.uv_index_max[i],
        is_today: isToday,
        relevance_reason: this.computeRelevance(condition, raw.daily.temperature_2m_max[i], date),
        cached_at: cachedAt,
      };
    });

    return {
      location: 'Ottawa, ON',
      today: days.find(d => d.is_today) ?? days[0],
      forecast: days.filter(d => !d.is_today).slice(0, 3),
      cached_at: cachedAt,
    };
  }

  // ── Private: decide if weather is worth mentioning to Robert ─────────────

  private computeRelevance(
    condition: WeatherCondition,
    tempHigh: number,
    date: string,
  ): string | undefined {
    const month = new Date(date).getMonth() + 1;
    const golfSeason = month >= 5 && month <= 10;
    const walkingInRoutine = this.profile.rhythms.daily.morning_routine
      .some(r => r.toLowerCase().includes('walk'));

    // Good walking day
    if (walkingInRoutine && (condition === 'clear' || condition === 'partly_cloudy') && tempHigh >= 5) {
      if (tempHigh >= 15) return 'Good day for a walk';
      return `Clear, ${Math.round(tempHigh)}°C — dress for it`;
    }

    // Bad walking day
    if (walkingInRoutine && (condition === 'rain' || condition === 'heavy_rain' || condition === 'snow')) {
      return 'Rain expected — walking conditions poor';
    }

    // Freezing rain — noteworthy for safety
    if (condition === 'freezing_rain') {
      return 'Freezing rain — hazardous outside';
    }

    // Extreme cold
    if (tempHigh < -15) {
      return `Extreme cold (${Math.round(tempHigh)}°C) — stay warm`;
    }

    // Golf season — good weekend day
    const dayOfWeek = new Date(date).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (golfSeason && isWeekend && (condition === 'clear' || condition === 'partly_cloudy')) {
      return 'Good conditions for golf';
    }

    return undefined;
  }

  // No OAuth token needed — override to always return true
  protected override async refreshToken(): Promise<boolean> {
    return true;
  }
}
