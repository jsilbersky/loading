package com.jsilb.loadingrush;

import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.annotation.NonNull;

import com.getcapacitor.BridgeActivity;

import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.RequestConfiguration;
import com.google.android.gms.ads.rewarded.RewardItem;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private WebView webView;

    // Stav rewarded reklamy
    private RewardedAd rewardedAd = null;
    private boolean isLoading = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ===== FULLSCREEN + nezhasínání displeje =====
        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Nastavit immersive sticky režim (schovat status + nav bar)
        applyImmersiveMode();

        // ===== PŮVODNÍ KÓD =====
        webView = getBridge().getWebView();

        // AdMob init
        MobileAds.initialize(this);

        // JSI most do JS
        webView.addJavascriptInterface(new RewardedJSI(), "RewardedJSI");

        // Polyfill Capacitor.Plugins.AdMob -> volá naše JSI, takže nemusíš nic měnit v JS
        injectAdMobFacade();
    }

    @Override
    public void onResume() {
        super.onResume();
        // po návratu do app znovu přepnout immersive (např. po reklamě / alt-tab)
        applyImmersiveMode();
        injectAdMobFacade(); // znovu “přilepí” polyfill, kdyby se WebView obnovilo
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // kdykoli získáme focus, obnovíme immersive režim
        if (hasFocus) applyImmersiveMode();
    }

    /** Nastaví systémové UI do immersive sticky fullscreen módu. */
    private void applyImmersiveMode() {
        final View decorView = getWindow().getDecorView();
        decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    /** Vstříkne do stránky objekt window.Capacitor.Plugins.AdMob s očekávanými metodami. */
    private void injectAdMobFacade() {
        String js =
                "(function(){try{"
                        + "window.Capacitor = window.Capacitor || {Plugins:{}};"
                        + "if(!window.Capacitor.Plugins) window.Capacitor.Plugins = {};"
                        + "if(!window.Capacitor.Plugins.AdMob){"
                        + "  const J = window.RewardedJSI;"
                        + "  window.Capacitor.Plugins.AdMob = {"
                        + "    initialize: function(o){ try{J.initialize(JSON.stringify(o||{}));}catch(e){} },"
                        + "    prepareRewardVideoAd: function(o){ try{J.prepare(JSON.stringify(o||{}));}catch(e){} },"
                        + "    showRewardVideoAd: function(){ try{J.show();}catch(e){} },"
                        + "    addListener: function(name, cb){"
                        + "      const h = function(ev){ try{ cb && cb(ev.detail||{}); }catch(e){} };"
                        + "      window.addEventListener(name, h);"
                        + "      return { remove: function(){ window.removeEventListener(name, h); } };"
                        + "    }"
                        + "  };"
                        + "}"
                        + "}catch(e){}})();";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    /** Odeslání eventu do JS: window.dispatchEvent(new CustomEvent(name,{detail})) */
    private void emit(String name, String jsonDetail) {
        String js = "try{window.dispatchEvent(new CustomEvent('"
                + name + "',{detail:" + (jsonDetail == null ? "{}" : jsonDetail) + "}));}catch(e){}";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    /** Načte callbacks pro FullScreen události. */
    private void attachFullScreenCallbacks() {
        if (rewardedAd == null) return;

        rewardedAd.setFullScreenContentCallback(new FullScreenContentCallback() {
            @Override
            public void onAdShowedFullScreenContent() {
                // volitelně
            }

            @Override
            public void onAdDismissedFullScreenContent() {
                emit("onRewardedVideoAdDismissed", "{}");
                rewardedAd = null; // po zavření invalidujeme
                // po zavření reklamy často zmizí immersive -> obnovit
                applyImmersiveMode();
            }

            @Override
            public void onAdFailedToShowFullScreenContent(@NonNull AdError adError) {
                emit("onRewardedVideoAdFailedToShow",
                        "{\"code\":" + adError.getCode() + ",\"message\":\"" + esc(adError.getMessage()) + "\"}");
                rewardedAd = null;
                applyImmersiveMode();
            }
        });
    }

    /** Escaping pro vložení do JS stringu. */
    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
    }

    /** ========= JSI most, volatelný z JS ========= */
    public class RewardedJSI {

        /** initialize({ initializeForTesting?:boolean, testDeviceIds?:string[] }) */
        @JavascriptInterface
        public void initialize(String json) {
            try {
                JSONObject o = new JSONObject(json == null ? "{}" : json);
                boolean testing = o.optBoolean("initializeForTesting", false);
                JSONArray arr = o.optJSONArray("testDeviceIds");

                if (testing || (arr != null && arr.length() > 0)) {
                    List<String> ids = new ArrayList<>();
                    if (arr != null) {
                        for (int i = 0; i < arr.length(); i++) ids.add(arr.optString(i));
                    }
                    RequestConfiguration.Builder b = new RequestConfiguration.Builder();
                    if (ids.isEmpty()) b.setTestDeviceIds(Arrays.asList(AdRequest.DEVICE_ID_EMULATOR));
                    else b.setTestDeviceIds(ids);
                    MobileAds.setRequestConfiguration(b.build());
                }
            } catch (Exception ignored) {}
        }

        /** prepare({ adId:string }) */
        @JavascriptInterface
        public void prepare(String json) {
            String adUnitId = null;
            try {
                JSONObject o = new JSONObject(json == null ? "{}" : json);
                adUnitId = o.optString("adId", null);
            } catch (Exception ignored) {}

            if (adUnitId == null || adUnitId.trim().isEmpty()) {
                emit("onRewardedVideoAdFailedToLoad", "{\"message\":\"Missing adId\"}");
                return;
            }
            if (rewardedAd != null) { // už je nahraná
                emit("onRewardedVideoAdLoaded", "{}");
                return;
            }
            if (isLoading) return;

            isLoading = true;

            AdRequest request = new AdRequest.Builder().build();
            final String finalId = adUnitId;

            RewardedAd.load(
                    getApplicationContext(),
                    finalId,
                    request,
                    new RewardedAdLoadCallback() {
                        @Override
                        public void onAdFailedToLoad(@NonNull LoadAdError loadAdError) {
                            isLoading = false;
                            rewardedAd = null;
                            emit("onRewardedVideoAdFailedToLoad",
                                    "{\"code\":" + loadAdError.getCode() + ",\"message\":\"" + esc(loadAdError.getMessage()) + "\"}");
                        }

                        @Override
                        public void onAdLoaded(@NonNull RewardedAd ad) {
                            isLoading = false;
                            rewardedAd = ad;
                            attachFullScreenCallbacks();
                            emit("onRewardedVideoAdLoaded", "{}");
                        }
                    }
            );
        }

        /** show() */
        @JavascriptInterface
        public void show() {
            if (rewardedAd == null) {
                emit("onRewardedVideoAdFailedToShow", "{\"message\":\"Ad is not loaded\"}");
                return;
            }
            runOnUiThread(() -> {
                rewardedAd.show(MainActivity.this, (RewardItem rewardItem) -> {
                    String detail = "{\"amount\":" + rewardItem.getAmount()
                            + ",\"type\":\"" + esc(rewardItem.getType()) + "\"}";
                    emit("onRewardedVideoAdReward", detail);
                });
            });
        }
    }
}
