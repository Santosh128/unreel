package com.unreel.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Queues auto-counted reels on the phone and uploads them to the API.
 * Counts stay queued (keyed "day|app") until the server accepts them,
 * so nothing is lost while the server is unreachable.
 */
public final class ReelStore {

    private static final String PREFS = "unreel";
    private static final String PENDING = "unreel.pending";
    private static final ExecutorService executor = Executors.newSingleThreadExecutor();

    public interface Listener {
        void onReel(String app);
        void onSynced();
    }

    private static volatile Listener listener;

    private ReelStore() {}

    public static void setListener(Listener l) {
        listener = l;
    }

    public static void configure(Context ctx, String apiUrl, String deviceId) {
        prefs(ctx).edit().putString("apiUrl", apiUrl).putString("deviceId", deviceId).apply();
        flush(ctx);
    }

    public static void record(Context ctx, String app) {
        String key = today() + "|" + app;
        synchronized (ReelStore.class) {
            SharedPreferences p = ctx.getSharedPreferences(PENDING, Context.MODE_PRIVATE);
            p.edit().putInt(key, p.getInt(key, 0) + 1).apply();
        }
        Listener l = listener;
        if (l != null) l.onReel(app);
        flush(ctx);
    }

    /** Drops queued counts that haven't been uploaded yet. */
    public static void clearPending(Context ctx) {
        synchronized (ReelStore.class) {
            ctx.getSharedPreferences(PENDING, Context.MODE_PRIVATE).edit().clear().apply();
        }
    }

    public static int pendingCount(Context ctx) {
        int total = 0;
        for (Object v : ctx.getSharedPreferences(PENDING, Context.MODE_PRIVATE).getAll().values()) {
            if (v instanceof Integer) total += (Integer) v;
        }
        return total;
    }

    public static void flush(Context ctx) {
        Context app = ctx.getApplicationContext();
        executor.execute(() -> upload(app));
    }

    private static void upload(Context ctx) {
        SharedPreferences config = prefs(ctx);
        String apiUrl = config.getString("apiUrl", null);
        String deviceId = config.getString("deviceId", null);
        if (apiUrl == null || deviceId == null) return;

        SharedPreferences pending = ctx.getSharedPreferences(PENDING, Context.MODE_PRIVATE);
        boolean sent = false;
        for (Map.Entry<String, ?> e : pending.getAll().entrySet()) {
            if (!(e.getValue() instanceof Integer)) continue;
            int amount = (Integer) e.getValue();
            String[] parts = e.getKey().split("\\|", 2);
            if (amount <= 0 || parts.length != 2) continue;
            if (!post(apiUrl, deviceId, parts[0], parts[1], amount)) return; // retry later
            synchronized (ReelStore.class) {
                // Subtract what was sent; more may have been recorded meanwhile
                int left = pending.getInt(e.getKey(), 0) - amount;
                if (left > 0) pending.edit().putInt(e.getKey(), left).apply();
                else pending.edit().remove(e.getKey()).apply();
            }
            sent = true;
        }
        Listener l = listener;
        if (sent && l != null) l.onSynced();
    }

    private static boolean post(String apiUrl, String deviceId, String day, String app, int amount) {
        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject();
            body.put("day", day);
            body.put("source", app);
            body.put("amount", amount);

            conn = (HttpURLConnection) new URL(apiUrl + "/reels").openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("X-Device-Id", deviceId);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            return conn.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }
}
