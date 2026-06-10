package app.telos.claudeterm

import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.widget.Toast
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.Manifest
import android.content.pm.PackageManager
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Thin native shell. Loads the chat UI from the cc-bridge server (bundled copy as
 * offline fallback) and bridges the hardware back button + the file picker so
 * attachments (<input type=file>) work inside the WebView.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    @Volatile private var rootFlag = true
    private var usedFallback = false
    @Volatile private var pageLoaded = false
    private var pendingConv: String? = null
    private val notifPerm = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val cb = filePathCallback; filePathCallback = null
        if (cb != null) {
            // Don't use FileChooserParams.parseResult: when a multi-select returns BOTH clipData and
            // a dataString, it overwrites the clipData array with the single dataString → only one (or
            // zero) file reaches the WebView. Parse manually, preferring clipData (the multi-select set).
            val data = if (result.resultCode == Activity.RESULT_OK) result.data else null
            val clip = data?.clipData
            val uris: Array<Uri>? = when {
                clip != null && clip.itemCount > 0 -> Array(clip.itemCount) { clip.getItemAt(it).uri }
                data?.data != null -> arrayOf(data.data!!)
                else -> null
            }
            cb.onReceiveValue(uris)
        }
    }

    companion object {
        // Where the WebView loads its UI. Empty (the default) → ship self-contained from the
        // bundled assets. To live-serve the UI from your own bridge instead (front-end hot reload),
        // set REMOTE_URL via CI (repo variable TELOS_REMOTE_URL) or local.properties (telos.remoteUrl).
        private val REMOTE_URL = BuildConfig.REMOTE_URL
        private const val BUNDLED_URL = "file:///android_asset/web/index.html"
        // host that stays inside the WebView (so tapped chat links open in the browser, not in-app)
        private val REMOTE_HOST: String? = try {
            if (REMOTE_URL.isNotBlank()) Uri.parse(REMOTE_URL).host?.lowercase() else null
        } catch (e: Exception) { null }
    }

    inner class AppBridge {
        @JavascriptInterface
        fun setAtRoot(v: Boolean) { rootFlag = v }

        @JavascriptInterface
        fun appVersion(): String = BuildConfig.VERSION_NAME

        // open a URL in the system browser (chat links must not navigate the in-app WebView away)
        @JavascriptInterface
        fun openUrl(url: String) {
            runOnUiThread {
                try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                catch (e: Exception) { Toast.makeText(this@MainActivity, "无法打开链接", Toast.LENGTH_SHORT).show() }
            }
        }

        @JavascriptInterface
        fun setStatusBar(visible: Boolean) {
            runOnUiThread {
                val c = WindowInsetsControllerCompat(window, web)
                c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                if (visible) c.show(WindowInsetsCompat.Type.statusBars())
                else c.hide(WindowInsetsCompat.Type.statusBars())
            }
        }

        // hand the bridge address + token to the native background service (which keeps its own
        // websocket for wake notifications). Called from JS after auth.
        @JavascriptInterface
        fun saveCreds(url: String, token: String) {
            getSharedPreferences(NotifyService.PREFS, Context.MODE_PRIVATE).edit()
                .putString("ws_url", url).putString("token", token).apply()
        }

        // 后台唤醒通知开关：start/stop the foreground service.
        @JavascriptInterface
        fun setNotify(enabled: Boolean) {
            getSharedPreferences(NotifyService.PREFS, Context.MODE_PRIVATE).edit().putBoolean("notify", enabled).apply()
            runOnUiThread {
                if (enabled) startNotify()
                else try { stopService(Intent(this@MainActivity, NotifyService::class.java)) } catch (e: Exception) {}
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this)
        setContentView(web)

        // True edge-to-edge: draw under the system bars and into the display cutout. The web UI
        // already pads with env(safe-area-inset-*) (viewport-fit=cover). Without this, hiding the
        // status bar on a notched device letterboxes the cutout strip in black ("空洞洞的黑色");
        // now the cream window background fills all the way to the top instead.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            // bundled UI 跑在 file://（origin "null"）——不开这个，XHR/fetch 打 bridge 全被 CORS 拦
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = true
            cacheMode = WebSettings.LOAD_NO_CACHE
        }
        // transparent so the window splash (logo on bg) shows through until the page paints
        web.setBackgroundColor(0x00000000)
        WebView.setWebContentsDebuggingEnabled(true)
        web.addJavascriptInterface(AppBridge(), "Android")

        web.webViewClient = object : WebViewClient() {
            // Keep the app's own UI (remote host + offline bundle) inside the WebView; send every
            // other navigation (external links tapped in chat, mailto:, tel:, …) to the OS so the
            // chat UI is never replaced — otherwise there's no way back without killing the app.
            override fun shouldOverrideUrlLoading(v: WebView, req: WebResourceRequest): Boolean {
                val u = req.url
                val scheme = u.scheme?.lowercase()
                if (scheme == "file" || (REMOTE_HOST != null && u.host?.lowercase() == REMOTE_HOST)) return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "无法打开链接", Toast.LENGTH_SHORT).show(); true
                }
            }
            override fun onReceivedError(v: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (req.isForMainFrame && !usedFallback) { usedFallback = true; v.loadUrl(BUNDLED_URL) }
            }
            override fun onPageFinished(v: WebView, url: String) { pageLoaded = true; flushConv() }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView?, callback: ValueCallback<Array<Uri>>?, params: FileChooserParams?
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                return try {
                    fileChooser.launch(params!!.createIntent()); true
                } catch (e: Exception) {
                    filePathCallback = null; false
                }
            }
        }

        // downloads (the /download endpoint) → system DownloadManager (shows progress in the notification)
        web.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            try {
                val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
                val req = DownloadManager.Request(Uri.parse(url))
                    .setMimeType(mimeType)
                    .setTitle(name)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                val ck = CookieManager.getInstance().getCookie(url)
                if (ck != null) req.addRequestHeader("cookie", ck)
                (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                Toast.makeText(this, "下载中：$name", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "下载失败：${e.message}", Toast.LENGTH_SHORT).show()
            }
        }

        web.loadUrl(if (REMOTE_URL.isNotBlank()) REMOTE_URL else BUNDLED_URL)

        handleConvIntent(intent)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (rootFlag) super.onBackPressed()
        else web.post { web.evaluateJavascript("window.onAndroidBack && window.onAndroidBack()", null) }
    }

    override fun onResume() { super.onResume(); AppState.foreground = true }
    override fun onPause() { super.onPause(); AppState.foreground = false }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); handleConvIntent(intent) }

    // a tapped wake notification carries the conversation id → open it once the page is ready
    private fun handleConvIntent(intent: Intent?) {
        val sid = intent?.getStringExtra(NotifyService.EXTRA_CONV)
        if (!sid.isNullOrEmpty()) { pendingConv = sid; flushConv() }
    }
    private fun flushConv() {
        val sid = pendingConv ?: return
        if (!pageLoaded) return
        pendingConv = null
        web.post { web.evaluateJavascript("window.__openConv && window.__openConv('" + sid.replace("'", "") + "')", null) }
    }
    private fun startNotify() {
        try {
            val i = Intent(this, NotifyService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i) else startService(i)
        } catch (e: Exception) {}
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
                if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                    @SuppressLint("BatteryLife")
                    val bi = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    startActivity(bi)
                }
            }
        } catch (e: Exception) {}
    }
}
