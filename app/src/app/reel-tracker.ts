import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** Native Android plugin (android/.../ReelTrackerPlugin.java) that auto-counts reels. */
export interface ReelTrackerPlugin {
  configure(options: { apiUrl: string; deviceId: string }): Promise<void>;
  status(): Promise<{ enabled: boolean; pending: number }>;
  openSettings(): Promise<void>;
  flush(): Promise<void>;
  clearPending(): Promise<void>;
  addListener(event: 'reel', fn: (data: { app: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'synced', fn: () => void): Promise<PluginListenerHandle>;
}

export const ReelTracker = registerPlugin<ReelTrackerPlugin>('ReelTracker');
