package com.unreel.app;

import android.content.Context;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Saves time on YouTube ads: taps "Skip" as soon as it appears, and mutes media while an ad
 * plays (so unskippable ads are silent), restoring the sound when the ad ends.
 *
 * Ads aren't removed (only YouTube Premium does that); this acts on screen like the user would.
 * Detection uses YouTube's view ids, found on a Samsung A15 with YouTube in English:
 *   skip_ad_button (clickable, text "Skip"), ad_progress_text ("Sponsored"),
 *   player_learn_more_button ("Visit advertiser").
 *
 * Turned off with the "skipAds" preference (on by default). Debug with: adb logcat -s Unreel
 */
final class AdSkipper {

    static final Set<String> PACKAGES = new HashSet<>(Arrays.asList(
        "com.google.android.youtube", "app.revanced.android.youtube"
    ));

    private static final String TAG = "Unreel";
    private static final long SCAN_THROTTLE_MS = 300;
    private static final long RECHECK_MS = 500;
    private static final long SKIP_RETRY_MS = 2000;
    private static final int MAX_NODES = 800;

    private final ReelAccessibilityService service;
    private final AudioManager audio;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private long lastScanAt = 0;
    private long lastSkipTapAt = 0;
    private boolean adOnScreen = false;
    private boolean skipRecorded = false;
    private boolean mutedByUs = false;

    private final Runnable recheck = this::scan;

    AdSkipper(ReelAccessibilityService service) {
        this.service = service;
        this.audio = (AudioManager) service.getSystemService(Context.AUDIO_SERVICE);
    }

    void onEvent(AccessibilityEvent event) {
        long now = SystemClock.uptimeMillis();
        if (now - lastScanAt < SCAN_THROTTLE_MS) return;
        scan();
    }

    private void scan() {
        lastScanAt = SystemClock.uptimeMillis();
        handler.removeCallbacks(recheck);
        if (!isEnabled(service)) {
            adEnded();
            return;
        }

        AccessibilityNodeInfo root = service.getRootInActiveWindow();
        if (root == null || root.getPackageName() == null
                || !PACKAGES.contains(root.getPackageName().toString())) {
            // Left YouTube while an ad was playing: give the sound back
            if (root != null) root.recycle();
            adEnded();
            return;
        }

        AccessibilityNodeInfo skip = null;
        boolean adBadge = false;
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty()) {
            AccessibilityNodeInfo node = queue.poll();
            boolean keep = false;
            if (visited++ < MAX_NODES && node.isVisibleToUser()) {
                String id = node.getViewIdResourceName();
                if (id != null) {
                    if (skip == null && id.endsWith(":id/skip_ad_button")) {
                        skip = node;
                        keep = true;
                    } else if (id.endsWith(":id/ad_progress_text") || id.endsWith(":id/player_learn_more_button")) {
                        adBadge = true;
                    }
                }
                for (int i = 0; i < node.getChildCount(); i++) {
                    AccessibilityNodeInfo child = node.getChild(i);
                    if (child != null) queue.add(child);
                }
            }
            if (!keep) node.recycle();
        }

        if (skip == null && !adBadge) {
            adEnded();
            return;
        }

        if (!adOnScreen) {
            adOnScreen = true;
            skipRecorded = false;
            Log.d(TAG, "ad on screen" + (skip != null ? " (skippable)" : ""));
            mute();
        }
        if (skip != null) {
            long now = SystemClock.uptimeMillis();
            if (now - lastSkipTapAt > SKIP_RETRY_MS && skip.isEnabled()) {
                lastSkipTapAt = now;
                boolean tapped = skip.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                Log.d(TAG, "tapped Skip: " + tapped);
                if (tapped && !skipRecorded) {
                    skipRecorded = true;
                    ReelStore.recordAdSkip(service);
                }
            }
            skip.recycle();
        }
        // Keep watching: the Skip button appears and the ad ends without a guaranteed event
        handler.postDelayed(recheck, RECHECK_MS);
    }

    private void adEnded() {
        if (adOnScreen) Log.d(TAG, "ad finished");
        adOnScreen = false;
        unmute();
    }

    private void mute() {
        if (audio == null || mutedByUs) return;
        // Leave it alone if the user muted media themselves, so we never unmute their choice
        if (audio.isStreamMute(AudioManager.STREAM_MUSIC)) return;
        audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, 0);
        mutedByUs = true;
        Log.d(TAG, "muted ad");
    }

    /** Restores sound if we muted it. Also called when the service stops, so it can't stay muted. */
    void unmute() {
        handler.removeCallbacks(recheck);
        if (audio == null || !mutedByUs) return;
        audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0);
        mutedByUs = false;
        Log.d(TAG, "unmuted");
    }

    static boolean isEnabled(Context ctx) {
        return ctx.getSharedPreferences("unreel", Context.MODE_PRIVATE).getBoolean("skipAds", true);
    }

    static void setEnabled(Context ctx, boolean enabled) {
        ctx.getSharedPreferences("unreel", Context.MODE_PRIVATE).edit().putBoolean("skipAds", enabled).apply();
    }
}
