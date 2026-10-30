package fr.cineidf.app;
import android.app.Activity; import android.content.Intent; import android.net.Uri; import android.os.Bundle; import android.webkit.*; import android.view.View; import android.graphics.Color;
public class Main extends Activity {
  static final String HOME = "https://cine-idf.onrender.com/";
  WebView w; GeolocationPermissions.Callback gcb; String gorigin;
  @Override protected void onCreate(Bundle b) {
    super.onCreate(b); w = new WebView(this); w.setBackgroundColor(Color.parseColor("#050505")); setContentView(w);
    WebSettings s = w.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true); s.setGeolocationEnabled(true); s.setCacheMode(WebSettings.LOAD_DEFAULT);
    s.setUserAgentString(s.getUserAgentString() + " CineIDFApp/1.0");
    w.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        Uri u = r.getUrl(); if ("cine-idf.onrender.com".equals(u.getHost())) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) {} return true; }
      @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
        if (r.isForMainFrame()) v.loadData("<body style='background:#050505;color:#e8d9a8;font-family:sans-serif;text-align:center;padding-top:40%'><h2 style='color:#c9a227'>CINÉ IDF</h2><p>Pas de connexion ou serveur en démarrage (≈50 s).</p><button style='background:#c9a227;border:0;padding:12px 20px;border-radius:10px;font-weight:bold' onclick=\"location.href='" + HOME + "'\">Réessayer</button></body>", "text/html; charset=utf-8", "UTF-8"); }
    });
    w.setWebChromeClient(new WebChromeClient() {
      @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
        if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == 0) { cb.invoke(origin, true, false); return; }
        gcb = cb; gorigin = origin; requestPermissions(new String[]{android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION}, 1); }
    });
    // téléchargement .ics -> navigateur
    w.setDownloadListener(new DownloadListener() { public void onDownloadStart(String url, String ua, String cd, String mime, long len) { try { if (!url.startsWith("blob:")) startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) {} } });
    Uri data = getIntent().getData();
    if (b != null) w.restoreState(b); else w.loadUrl(data != null ? data.toString() : HOME);
  }
  @Override public void onRequestPermissionsResult(int c, String[] p, int[] r) { if (gcb != null) { gcb.invoke(gorigin, r.length > 0 && r[0] == 0, false); gcb = null; } }
  @Override protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); w.saveState(b); }
  @Override public void onBackPressed() { if (w.canGoBack()) w.goBack(); else super.onBackPressed(); }
}
