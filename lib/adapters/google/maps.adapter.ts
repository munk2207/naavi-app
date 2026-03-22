/**
 * Google Maps Adapter
 *
 * Implements MapsAdapter using the existing maps.ts lib functions.
 * Maps Google Maps travel time data into the normalized NavigationResult type.
 */

import { fetchTravelTime as googleFetchTravelTime } from '../../../lib/maps';

import type { MapsAdapter } from '../interfaces';
import type { NavigationResult } from '../../types';

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class GoogleMapsAdapter implements MapsAdapter {

  async fetchTravelTime(
    destination: string,
    eventStartISO: string,
  ): Promise<NavigationResult | null> {
    const raw = await googleFetchTravelTime(destination, eventStartISO);
    if (!raw) return null;

    return {
      destination,
      durationMinutes: Math.round(raw.durationSeconds / 60),
      distanceKm:      Math.round((raw.distanceMeters / 1000) * 10) / 10,
      leaveByMs:       raw.leaveByMs,
      summary:         raw.summary,
      provider:        'google_maps',
    };
  }
}
