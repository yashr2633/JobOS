package com.jobtrackos.app;

import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Bridge;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Configure bridge to handle external URLs properly
        this.bridge.setServerUrl("https://jobtrackos.online");
    }

    @Override
    public void onStart() {
        super.onStart();
        
        // Get the WebView and set up client to prevent external browser launches
        WebView webView = this.bridge.getWebView();
        if (webView != null) {
            webView.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    // Keep OAuth and all navigation within the WebView
                    if (url.startsWith("https://jobtrackos.online") || 
                        url.startsWith("https://accounts.google.com") ||
                        url.contains("oauth") || url.contains("auth")) {
                        view.loadUrl(url);
                        return true;
                    }
                    return super.shouldOverrideUrlLoading(view, url);
                }
            });
        }
    }
}
