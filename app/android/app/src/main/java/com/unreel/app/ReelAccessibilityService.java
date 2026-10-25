package com.unreel.app;

import android.accessibilityservice.AccessibilityService;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Rect;
import android.os.SystemClock;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import java.util.Arrays;

/**
 * Counts reels by watching scroll events from full-screen vertical players.
 *
 * Only full-screen scrolling views on a screen with a reel marker ("reel", "clips", "shorts"
 * in view ids or labels) are considered. Then:
 *  - Opening a reel player counts the reel on screen once.
 *  - Views that report item indexes count each time they settle on a single item further
 *    down than any seen before.
 *  - Views without indexes (YouTube Shorts) must have a reel word in their own view id. They
 *    count one per burst of scroll events, and only when the view actually moved. Players fire
 *    motionless scroll events while opening and loading; counting those caused double counts.
 *  - For views without indexes, nothing counts within MIN_COUNT_GAP_MS of the previous count.
 *
 * You have left the reel player, and the next reel event counts as a fresh opening, when:
 *  - a feed scrolls: several items visible in a view whose id isn't a reel view (YouTube's home
 *    shows only 2 large cards at a time, so "several" means 2+ there), or
 *  - the view that opened the player is recreated (Shorts reopened from the tab bar without
 *    scrolling the home feed in between).
 * The session also resets on app switch and after SESSION_IDLE_MS without scrolling.
 *
 * Debug with: adb logcat -s Unreel
 */
public class ReelAccessibilityService extends AccessibilityService {

    private static final Map<String, String> KNOWN_APPS = new HashMap<>();
    static {
        KNOWN_APPS.put("com.instagram.android", "Instagram");
        KNOWN_APPS.put("com.instagram.lite", "Instagram");
        KNOWN_APPS.put("com.facebook.katana", "Facebook");
        KNOWN_APPS.put("com.facebook.lite", "Facebook");
        KNOWN_APPS.put("com.google.android.youtube", "YouTube");
        KNOWN_APPS.put("app.revanced.android.youtube", "YouTube");
        KNOWN_APPS.put("com.zhiliaoapp.musically", "TikTok");
        KNOWN_APPS.put("com.ss.android.ugc.trill", "TikTok");
        KNOWN_APPS.put("com.snapchat.android", "Snapchat");
        KNOWN_APPS.put("in.mohalla.video", "Moj");
        KNOWN_APPS.put("in.mohalla.sharechat", "ShareChat");
        KNOWN_APPS.put("com.eterno.shortvideos", "Josh");
    }

    // Matched as whole words, so "Inshorts" does not count as "shorts". Singular "short" and
    // "clip" are left out: they are too common (Inshorts labels articles "Bookmark Short").
    private static final Set<String> MARKERS = new HashSet<>(Arrays.asList(
        "reel", "reels", "clips", "shorts", "spotlight"
    ));

    // Never count inside these (our own app, system UI, full-screen card apps that aren't video)
    private static final Set<String> IGNORED = new HashSet<>(Arrays.asList(
        "com.unreel.app", "com.android.systemui", "com.android.settings",
        "com.nis.app" // Inshorts news cards
    ));

    private static final String TAG = "Unreel";
    private static final long MARKER_CACHE_MS = 3000;
    private static final long SWIPE_GAP_MS = 700;
    private static final long MIN_COUNT_GAP_MS = 800;
    private static final long SESSION_IDLE_MS = 60_000;
    private static final int MAX_NODES = 400;

    private String sessionKey = "";
    // Whether the reel on screen when the player opened has been counted
    private boolean inPlayer = false;
    // The non-indexed view that opened the player (YouTube: reel_recycler) and its node identity
    private String openerViewId = null;
    private int openerNode = 0;
    // Furthest item index seen per scrolling view (for views that report indexes)
    private final Map<Integer, Integer> maxIndexByView = new HashMap<>();
    private long lastScrollAt = 0;
    private long lastCountAt = 0;
    private boolean burstCounted = false;
    private long markerCheckedAt = 0;
    private boolean markerFound = false;

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        CharSequence pkgCs = event.getPackageName();
        if (pkgCs == null) return;
        String pkg = pkgCs.toString();
        if (IGNORED.contains(pkg) || pkg.contains("launcher")) return;

        if (event.getEventType() != AccessibilityEvent.TYPE_VIEW_SCROLLED) return;

        AccessibilityNodeInfo source = event.getSource();
        if (source == null) return;
        try {
            if (!isFullScreen(source)) return;
            long now = SystemClock.uptimeMillis();
            if (!pkg.equals(sessionKey) || now - lastScrollAt > SESSION_IDLE_MS) resetSession(pkg);
            if (!hasReelMarker(now)) return;

            int from = event.getFromIndex();
            int to = event.getToIndex();
            boolean newBurst = now - lastScrollAt > SWIPE_GAP_MS;
            lastScrollAt = now;
            if (newBurst) burstCounted = false;

            boolean counted;
            boolean indexed = from >= 0 && to >= 0;
            String viewId = source.getViewIdResourceName();
            boolean reelView = matches(viewId);
            if (indexed && (to - from >= 2 || (to > from && !reelView))) {
                // A feed, not a reel player: the next reel event is a fresh opening
                inPlayer = false;
                maxIndexByView.clear();
                counted = false;
            } else if (indexed) {
                counted = countByIndex(source.hashCode(), from, to);
                inPlayer = true;
            } else if (!reelView) {
                // Without indexes there is little to go on, so the scrolling view itself must be
                // a reel player (YouTube: reel_recycler, reel_player_underlay). A reel word
                // elsewhere on screen, like a Play Store listing, is not enough.
                counted = false;
            } else if (!inPlayer || (viewId.equals(openerViewId) && source.hashCode() != openerNode)) {
                counted = true; // the reel shown when the player opened (or was reopened)
                inPlayer = true;
                burstCounted = true;
                openerViewId = viewId;
                openerNode = source.hashCode();
            } else {
                counted = !burstCounted && hasMoved(event);
                if (counted) burstCounted = true;
            }

            // Indexed players are already de-duplicated by position (Instagram settles on the
            // next reel ~200ms after leaving the last one), so the time gap only guards the rest
            if (counted && !indexed && now - lastCountAt < MIN_COUNT_GAP_MS) counted = false;
            Log.d(TAG, pkg + " from=" + from + " to=" + to + " y=" + event.getScrollY()
                + " id=" + viewId + " node=" + source.hashCode() + " counted=" + counted);
            if (counted) {
                lastCountAt = now;
                ReelStore.record(this, appName(pkg));
            }
        } finally {
            source.recycle();
        }
    }

    private static boolean hasMoved(AccessibilityEvent event) {
        if (event.getScrollY() != 0 || event.getScrollX() != 0) return true;
        return android.os.Build.VERSION.SDK_INT >= 28 && event.getScrollDeltaY() != 0;
    }

    private boolean countByIndex(int viewKey, int from, int to) {
        // A reel player shows exactly one item once settled; mid-swipe it shows two
        boolean single = from == to;
        Integer max = maxIndexByView.get(viewKey);
        if (max == null || (single && from == 0 && max > 0)) {
            // First time we see this view, or the list restarted at the top
            maxIndexByView.put(viewKey, from);
            return single;
        }
        if (single && from > max) {
            maxIndexByView.put(viewKey, from);
            return true;
        }
        return false;
    }

    private void resetSession(String key) {
        sessionKey = key;
        inPlayer = false;
        openerViewId = null;
        openerNode = 0;
        maxIndexByView.clear();
        markerCheckedAt = 0;
        lastScrollAt = 0;
        lastCountAt = 0;
        burstCounted = false;
    }

    private boolean isFullScreen(AccessibilityNodeInfo node) {
        Rect r = new Rect();
        node.getBoundsInScreen(r);
        int screenH = getResources().getDisplayMetrics().heightPixels;
        int screenW = getResources().getDisplayMetrics().widthPixels;
        return r.height() >= screenH * 0.7 && r.width() >= screenW * 0.9;
    }

    private boolean hasReelMarker(long now) {
        if (now - markerCheckedAt < MARKER_CACHE_MS) return markerFound;
        markerCheckedAt = now;
        markerFound = scanForMarker(getRootInActiveWindow());
        return markerFound;
    }

    /** Breadth-first search of the window for a view id or label mentioning reels. */
    private boolean scanForMarker(AccessibilityNodeInfo root) {
        if (root == null) return false;
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        boolean found = false;
        while (!queue.isEmpty()) {
            AccessibilityNodeInfo node = queue.poll();
            if (!found && visited++ < MAX_NODES) {
                CharSequence hit = matches(node.getViewIdResourceName()) ? node.getViewIdResourceName()
                    : matches(node.getContentDescription()) ? node.getContentDescription()
                    : matches(node.getText()) ? node.getText() : null;
                if (hit != null) {
                    Log.d(TAG, "reel marker: " + hit);
                    found = true;
                } else {
                    for (int i = 0; i < node.getChildCount(); i++) {
                        AccessibilityNodeInfo child = node.getChild(i);
                        if (child != null) queue.add(child);
                    }
                }
            }
            node.recycle();
        }
        return found;
    }

    private static boolean matches(CharSequence value) {
        if (value == null || value.length() == 0 || value.length() > 120) return false;
        // Split "com.app:id/reel_player", "reelPlayer" and "Watch Reels" into words
        String words = value.toString().replaceAll("([a-z])([A-Z])", "$1 $2").toLowerCase(Locale.ROOT);
        for (String word : words.split("[^a-z]+")) {
            if (MARKERS.contains(word)) return true;
        }
        return false;
    }

    private String appName(String pkg) {
        String known = KNOWN_APPS.get(pkg);
        if (known != null) return known;
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo info = pm.getApplicationInfo(pkg, 0);
            return pm.getApplicationLabel(info).toString();
        } catch (PackageManager.NameNotFoundException e) {
            return pkg;
        }
    }

    @Override
    public void onInterrupt() {}
}
