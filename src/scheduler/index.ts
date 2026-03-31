/**
 * Naavi — Scheduler Bootstrap
 *
 * This is what App.tsx calls once on startup.
 * It wires together the orchestrator, the brief cache, and the scheduler
 * and returns a single object the app can use.
 *
 * Usage in App.tsx:
 *
 *   import { bootstrapScheduler } from './src/scheduler';
 *
 *   useEffect(() => {
 *     bootstrapScheduler(db, tokenStore, profile).then(setScheduler);
 *   }, []);
 */

import { IntegrationOrchestrator, createIntegrationOrchestrator } from '../integrations/index';
import { SyncScheduler, registerMorningNotificationHandler } from './sync-scheduler';
import { MorningBriefCache } from './morning-brief-cache';
import type { LocalDB, TokenStore } from '../integrations/base-adapter';
import type { CognitiveProfile } from '../../schema/cognitive-profile';

export interface SchedulerBootstrap {
  orchestrator: IntegrationOrchestrator;
  briefCache: MorningBriefCache;
  scheduler: SyncScheduler;
}

/**
 * Bootstrap the entire background sync system.
 *
 * Steps:
 * 1. Create the integration orchestrator
 * 2. Create the morning brief cache
 * 3. Create and register the sync scheduler
 * 4. Register the morning notification handler
 * 5. Run an immediate sync if no data exists yet (first launch)
 * 6. Assemble the morning brief if it is not already ready
 */
export async function bootstrapScheduler(
  db: LocalDB,
  tokenStore: TokenStore,
  profile: CognitiveProfile,
): Promise<SchedulerBootstrap> {
  const orchestrator = createIntegrationOrchestrator(db, tokenStore, profile);
  const briefCache = new MorningBriefCache(db, orchestrator, profile);
  const scheduler = new SyncScheduler(orchestrator, briefCache);

  // Register background tasks and the 07:00 notification
  await scheduler.register();

  // Register the in-app notification handler (fires when app is open at 07:00)
  registerMorningNotificationHandler();

  // If no brief is ready for today, assemble one now
  // This covers: first launch, app opened early, or missed morning sync
  const briefReady = await briefCache.isReady();
  if (!briefReady) {
    // Non-blocking — brief assembles in the background
    briefCache.assembleOnDemand().catch(() => {
      // Swallow — app works without the pre-assembled brief
    });
  }

  return { orchestrator, briefCache, scheduler };
}

// Re-export for convenience
export { SyncScheduler, MorningBriefCache };
export type { SchedulerDiagnostics } from './sync-scheduler';
export type { CachedBrief } from './morning-brief-cache';
