package app.telos.claudeterm

import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
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
import androidx.core.view.ViewCompat
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
    @Volatile private var safeTopPx = -1   // 系统真实顶部 inset（px），喂给页面当 --safe-top
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

        // download via the system DownloadManager. Bundled mode hands every <a> navigation to the
        // external browser (shouldOverrideUrlLoading), so the WebView's DownloadListener never
        // fires — JS calls this directly instead.
        @JavascriptInterface
        fun download(url: String, name: String) {
            runOnUiThread {
                try {
                    val fn = if (name.isNotBlank()) name else URLUtil.guessFileName(url, null, null)
                    val req = DownloadManager.Request(Uri.parse(url))
                        .setTitle(fn)
                        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fn)
                    if (fn.endsWith(".apk")) req.setMimeType("application/vnd.android.package-archive")
                    (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                    Toast.makeText(this@MainActivity, "下载中：$fn", Toast.LENGTH_SHORT).show()
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "下载失败：${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }

        // open a URL in the system browser (chat links must not navigate the in-app WebView away)
        @JavascriptInterface
        fun openUrl(url: String) {
            runOnUiThread {
                try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                catch (e: Exception) { Toast.makeText(this@MainActivity, "无法打开链接", Toast.LENGTH_SHORT).show() }
            }
        }

        // 系统分享面板：选词浮条「分享」调它，把选中文字 ACTION_SEND 给微信/QQ/备忘录等
        @JavascriptInterface
        fun shareText(text: String) {
            runOnUiThread {
                try {
                    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
                    startActivity(Intent.createChooser(send, "分享").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (e: Exception) { Toast.makeText(this@MainActivity, "无法分享：${e.message}", Toast.LENGTH_SHORT).show() }
            }
        }

        // 页面启动时拉真实顶部 inset（dp）；还没量到（首帧前）返回 -1，页面沿用 env() 兜底
        @JavascriptInterface
        fun insetTop(): Float = if (safeTopPx < 0) -1f else safeTopPx / resources.displayMetrics.density

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

        // 选中正文（只读）时压掉系统自带的选词工具条，保留选区手柄，让前端浮条（#selBar）独占；
        // 但输入框是可编辑的——它的剪切/复制/粘贴菜单要留着（否则没法往输入框里粘贴）。
        // 办法：照常委托原回调把菜单填好，只在「没有 粘贴/剪切 项」（即只读选择）时才清空。
        web = object : WebView(this) {
            private fun hasEditItems(menu: Menu?): Boolean =
                menu != null && (menu.findItem(android.R.id.paste) != null || menu.findItem(android.R.id.cut) != null
                    || menu.findItem(android.R.id.pasteAsPlainText) != null)
            private fun wrap(orig: ActionMode.Callback?): ActionMode.Callback2 = object : ActionMode.Callback2() {
                override fun onCreateActionMode(mode: ActionMode?, menu: Menu?): Boolean = orig?.onCreateActionMode(mode, menu) ?: true
                override fun onPrepareActionMode(mode: ActionMode?, menu: Menu?): Boolean {
                    val r = orig?.onPrepareActionMode(mode, menu) ?: false   // 先让原回调填充菜单
                    if (!hasEditItems(menu)) { menu?.clear(); return true }  // 只读选择 → 清空给浮条
                    return r                                                 // 可编辑（输入框）→ 保留系统菜单
                }
                override fun onActionItemClicked(mode: ActionMode?, item: MenuItem?): Boolean = orig?.onActionItemClicked(mode, item) ?: false
                override fun onDestroyActionMode(mode: ActionMode?) { orig?.onDestroyActionMode(mode) }
                override fun onGetContentRect(mode: ActionMode?, view: View?, outRect: Rect?) {
                    if (orig is ActionMode.Callback2) orig.onGetContentRect(mode, view, outRect)
                    else super.onGetContentRect(mode, view, outRect)   // 保持选区手柄定位
                }
            }
            override fun startActionMode(callback: ActionMode.Callback?): ActionMode? =
                super.startActionMode(wrap(callback))
            override fun startActionMode(callback: ActionMode.Callback?, type: Int): ActionMode? =
                super.startActionMode(wrap(callback), type)
        }
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

        // WebView 的 env(safe-area-inset-top) 在部分 ROM 上只反映刘海、或藏了状态栏还残留旧值，
        // 顶栏「贴零」贴不上去全因它虚高。这里把系统真实 inset（状态栏可见高度与刘海取大者）
        // 实时喂给页面盖掉 env()；页面自己启动时也会经 Android.insetTop() 拉一次。
        ViewCompat.setOnApplyWindowInsetsListener(web) { v, ins ->
            val top = maxOf(
                ins.getInsets(WindowInsetsCompat.Type.statusBars()).top,
                ins.getInsets(WindowInsetsCompat.Type.displayCutout()).top
            )
            if (top != safeTopPx) {
                safeTopPx = top
                val dp = top / resources.displayMetrics.density
                web.evaluateJavascript("document.documentElement.style.setProperty('--safe-top','${dp}px')", null)
            }
            // 这个监听会取代 WebView 自己的 onApplyWindowInsets——必须把默认处理补走完，
            // 否则 WebView 感知不到输入法高度、视口不收缩，输入框被键盘整个盖住（1.1.97 踩过）
            ViewCompat.onApplyWindowInsets(v, ins)
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
