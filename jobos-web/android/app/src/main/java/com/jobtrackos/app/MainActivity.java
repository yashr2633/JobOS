package com.jobtrackos.app;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.Uri;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onStart() {
        super.onStart();
        
        // Get the bridge's WebView
        WebView webView = getBridge().getWebView();
        
        if (webView != null) {
            // Configure WebView settings
            webView.getSettings().setJavaScriptEnabled(true);
            webView.getSettings().setDomStorageEnabled(true);
            webView.getSettings().setDatabaseEnabled(true);
            webView.getSettings().setAllowFileAccess(true);
            webView.getSettings().setAllowContentAccess(true);
            
            // Set custom WebViewClient to prevent external browser launches
            webView.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String url = request.getUrl().toString();
                    
                    // Always load these URLs in the WebView, never externally
                    if (url.startsWith("https://jobtrackos.online") || 
                        url.contains("accounts.google.com") ||
                        url.contains("oauth2") ||
                        url.contains("auth") ||
                        url.contains("gmail")) {
                        view.loadUrl(url);
                        return true;
                    }
                    
                    // For capacitor:// URLs, let the bridge handle them
                    if (url.startsWith("capacitor://")) {
                        return false;
                    }
                    
                    // Default: load in WebView
                    view.loadUrl(url);
                    return true;
                }
                
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    // Fallback for older Android versions
                    if (url.startsWith("https://jobtrackos.online") || 
                        url.contains("accounts.google.com") ||
                        url.contains("oauth2") ||
                        url.contains("auth") ||
                        url.contains("gmail")) {
                        view.loadUrl(url);
                        return true;
                    }
                    
                    if (url.startsWith("capacitor://")) {
                        return false;
                    }
                    
                    view.loadUrl(url);
                    return true;
                }
            });
        }
    }
}
