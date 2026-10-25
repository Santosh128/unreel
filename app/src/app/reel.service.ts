import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { environment } from '../environments/environment';

export interface DayCount {
  day: string;
  count: number;
}

export interface SourceCount {
  source: string;
  count: number;
}

export interface Today extends DayCount {
  limit: number;
  sources: SourceCount[];
}

export interface HistoryDay extends DayCount {
  sources: SourceCount[];
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/** Local calendar date as YYYY-MM-DD (not UTC, so the day flips at local midnight). */
export function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

@Injectable({ providedIn: 'root' })
export class ReelService {
  private http = inject(HttpClient);

  private readonly defaultApiUrl = Capacitor.isNativePlatform() ? environment.apiUrl : environment.webApiUrl;
  apiUrl = storageGet('unreel.apiUrl') ?? this.defaultApiUrl;
  readonly deviceId = this.loadDeviceId();

  private loadDeviceId(): string {
    let id = storageGet('unreel.deviceId');
    if (!id) {
      id = crypto.randomUUID();
      storageSet('unreel.deviceId', id);
    }
    return id;
  }

  setApiUrl(url: string) {
    // Only remember a URL the user actually changed; otherwise keep following the build's
    // default, so a new build (e.g. moving from local testing to the server) takes effect.
    // An empty field also goes back to the default.
    const cleaned = url.trim().replace(/\/+$/, '');
    if (!cleaned || cleaned === this.defaultApiUrl) {
      this.apiUrl = this.defaultApiUrl;
      storageRemove('unreel.apiUrl');
    } else {
      this.apiUrl = cleaned;
      storageSet('unreel.apiUrl', cleaned);
    }
  }

  private get headers() {
    return new HttpHeaders({ 'X-Device-Id': this.deviceId });
  }

  today() {
    return firstValueFrom(
      this.http.get<Today>(`${this.apiUrl}/today`, { headers: this.headers, params: { day: localDay() } }),
    );
  }

  add(amount = 1) {
    return firstValueFrom(
      this.http.post<DayCount>(`${this.apiUrl}/reels`, { day: localDay(), amount }, { headers: this.headers }),
    );
  }

  undo() {
    return firstValueFrom(
      this.http.post<DayCount>(`${this.apiUrl}/reels/undo`, { day: localDay() }, { headers: this.headers }),
    );
  }

  reset() {
    return firstValueFrom(
      this.http.post<DayCount>(`${this.apiUrl}/reels/reset`, { day: localDay() }, { headers: this.headers }),
    );
  }

  history(days = 30) {
    return firstValueFrom(
      this.http.get<HistoryDay[]>(`${this.apiUrl}/history`, { headers: this.headers, params: { days } }),
    );
  }

  setLimit(limit: number) {
    return firstValueFrom(
      this.http.put<{ limit: number }>(`${this.apiUrl}/settings`, { limit }, { headers: this.headers }),
    );
  }
}
