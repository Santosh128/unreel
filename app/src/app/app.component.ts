import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { DayCount, HistoryDay, localDay, ReelService, SourceCount } from './reel.service';
import { ReelTracker } from './reel-tracker';

@Component({
  selector: 'app-root',
  imports: [FormsModule, DatePipe],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  private reels = inject(ReelService);

  count = signal(0);
  limit = signal(20);
  history = signal<HistoryDay[]>([]);
  sources = signal<SourceCount[]>([]);
  // null = not on Android, so auto counting isn't available
  autoEnabled = signal<boolean | null>(null);
  pending = signal(0);
  skipAds = signal(true);
  adsSkipped = signal(0);
  error = signal('');
  busy = signal(false);
  showSettings = signal(false);

  apiUrlInput = this.reels.apiUrl;
  readonly deviceId = this.reels.deviceId;
  readonly deviceModel = this.reels.deviceModel;
  limitInput = 20;

  private currentDay = localDay();
  private dayTimer?: ReturnType<typeof setInterval>;
  private listeners: PluginListenerHandle[] = [];
  private reloadTimer?: ReturnType<typeof setTimeout>;

  progress = computed(() => Math.min(this.count() / this.limit(), 1));
  overLimit = computed(() => this.count() >= this.limit());
  // Circumference of the r=88 progress ring
  readonly ring = 2 * Math.PI * 88;

  /** Last 7 days, oldest first, with zeros filled in for missing days. */
  week = computed(() => {
    const byDay = new Map(this.history().map((h) => [h.day, h.count]));
    const days: DayCount[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const day = localDay(d);
      days.push({ day, count: day === this.currentDay ? this.count() : byDay.get(day) ?? 0 });
    }
    return days;
  });
  weekMax = computed(() => Math.max(this.limit(), ...this.week().map((d) => d.count)));
  weekAvg = computed(() => Math.round(this.week().reduce((s, d) => s + d.count, 0) / 7));

  ngOnInit() {
    this.load();
    // Reset when midnight passes while the app is open
    this.dayTimer = setInterval(() => {
      if (localDay() !== this.currentDay) this.load();
    }, 60_000);
    document.addEventListener('visibilitychange', this.onVisible);
    this.initAutoCounting();
  }

  ngOnDestroy() {
    clearInterval(this.dayTimer);
    clearTimeout(this.reloadTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.listeners.forEach((l) => l.remove());
  }

  private onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    this.refreshAutoStatus();
    this.load();
  };

  private async initAutoCounting() {
    if (Capacitor.getPlatform() !== 'android') return;
    await ReelTracker.configure({ apiUrl: this.reels.apiUrl, deviceId: this.reels.deviceId });
    this.listeners.push(
      await ReelTracker.addListener('synced', () => this.scheduleReload()),
      await ReelTracker.addListener('reel', () => this.refreshAutoStatus()),
      await ReelTracker.addListener('adSkipped', () => this.scheduleReload()),
    );
    await this.refreshAutoStatus();
  }

  private async refreshAutoStatus() {
    if (Capacitor.getPlatform() !== 'android') return;
    const { enabled, pending, skipAds } = await ReelTracker.status();
    this.autoEnabled.set(enabled);
    this.pending.set(pending);
    this.skipAds.set(skipAds ?? true);
  }

  // Native sync events can arrive in bursts; reload once they settle
  private scheduleReload() {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.refreshAutoStatus();
      this.load();
    }, 500);
  }

  sourceName(source: string) {
    return source === 'manual' ? 'Tapped manually' : source;
  }

  async toggleSkipAds(enabled: boolean) {
    this.skipAds.set(enabled);
    await ReelTracker.setSkipAds({ enabled });
  }

  enableAutoCounting() {
    ReelTracker.openSettings();
  }

  async load() {
    this.currentDay = localDay();
    try {
      const [today, history] = await Promise.all([this.reels.today(), this.reels.history(30)]);
      this.count.set(today.count);
      this.limit.set(today.limit);
      this.limitInput = today.limit;
      this.sources.set(today.sources);
      this.adsSkipped.set(today.adsSkipped ?? 0);
      this.history.set(history);
      this.error.set('');
    } catch {
      this.error.set(`Can't reach the server at ${this.reels.apiUrl}`);
    }
  }

  async add(amount = 1) {
    navigator.vibrate?.(20);
    await this.run(() => this.reels.add(amount));
  }

  async undo() {
    await this.run(() => this.reels.undo());
  }

  async reset() {
    if (!confirm(`Reset today's count of ${this.count()} reels to 0?`)) return;
    await this.run(async () => {
      // Drop queued auto counts too, or they'd be uploaded again after the reset
      if (Capacitor.getPlatform() === 'android') await ReelTracker.clearPending();
      await this.reels.reset();
    });
    this.refreshAutoStatus();
  }

  async saveSettings() {
    this.reels.setApiUrl(this.apiUrlInput);
    if (Capacitor.getPlatform() === 'android') {
      await ReelTracker.configure({ apiUrl: this.reels.apiUrl, deviceId: this.reels.deviceId });
    }
    await this.run(async () => {
      await this.reels.setLimit(this.limitInput);
      this.showSettings.set(false);
    });
  }

  private async run(fn: () => Promise<unknown>) {
    this.busy.set(true);
    try {
      await fn();
      await this.load();
    } catch {
      this.error.set(`Can't reach the server at ${this.reels.apiUrl}`);
    } finally {
      this.busy.set(false);
    }
  }
}
