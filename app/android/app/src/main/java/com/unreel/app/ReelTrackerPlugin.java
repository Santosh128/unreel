package com.unreel.app;

import android.content.ComponentName;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.text.TextUtils;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ReelTracker")
public class ReelTrackerPlugin extends Plugin implements ReelStore.Listener {

    @Override
    public void load() {
        ReelStore.setListener(this);
    }

    @Override
    protected void handleOnDestroy() {
        ReelStore.setListener(null);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        String apiUrl = call.getString("apiUrl");
        String deviceId = call.getString("deviceId");
        if (apiUrl == null || deviceId == null) {
            call.reject("apiUrl and deviceId are required");
            return;
        }
        ReelStore.configure(getContext(), apiUrl, deviceId);
        call.resolve();
    }

    /** Stable per-device id (ANDROID_ID survives reinstalls; unique per device and signing key). */
    @PluginMethod
    public void deviceInfo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("id", Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ANDROID_ID));
        ret.put("model", Build.MANUFACTURER + " " + Build.MODEL);
        call.resolve(ret);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", isServiceEnabled());
        ret.put("pending", ReelStore.pendingCount(getContext()));
        ret.put("skipAds", AdSkipper.isEnabled(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /** Unreel's App info page, where "Allow restricted settings" lives for APK installs. */
    @PluginMethod
    public void openAppInfo(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            android.net.Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void flush(PluginCall call) {
        ReelStore.flush(getContext());
        call.resolve();
    }

    @PluginMethod
    public void setSkipAds(PluginCall call) {
        AdSkipper.setEnabled(getContext(), Boolean.TRUE.equals(call.getBoolean("enabled", true)));
        call.resolve();
    }

    @PluginMethod
    public void clearPending(PluginCall call) {
        ReelStore.clearPending(getContext());
        call.resolve();
    }

    private boolean isServiceEnabled() {
        String enabled = Settings.Secure.getString(
            getContext().getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null) return false;
        ComponentName me = new ComponentName(getContext(), ReelAccessibilityService.class);
        TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
        splitter.setString(enabled);
        for (String s : splitter) {
            ComponentName c = ComponentName.unflattenFromString(s);
            if (me.equals(c)) return true;
        }
        return false;
    }

    @Override
    public void onReel(String app) {
        JSObject data = new JSObject();
        data.put("app", app);
        notifyListeners("reel", data);
    }

    @Override
    public void onAdSkipped() {
        notifyListeners("adSkipped", new JSObject());
    }

    @Override
    public void onSynced() {
        notifyListeners("synced", new JSObject());
    }
}
