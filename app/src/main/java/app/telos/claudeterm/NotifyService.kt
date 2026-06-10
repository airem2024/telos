package app.telos.claudeterm

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Shared app-foreground flag so the service can stay quiet while you're looking at the app. */
object AppState { @Volatile var foreground = false }

/**
 * Foreground service that keeps a WebSocket open to the user's own cc-bridge and turns
 * `wake_message` broadcasts into local notifications (tap → open that conversation in Telos).
 * Replaces the ntfy detour: one app, native notifications, deep-link back into the chat.
 */
class NotifyService : Service() {
    private var client: OkHttpClient? = null
    private var ws: WebSocket? = null
    @Volatile private var stopped = false
    private val handler = Handler(Looper.getMainLooper())
    private var nextId = 2000
    private var fails = 0
    private var netCb: ConnectivityManager.NetworkCallback? = null

    companion object {
        const val CH_ONGOING = "telos_bg"
        const val CH_WAKE = "telos_wake"
        const val FG_ID = 1001
        const val PREFS = "telos"
        const val EXTRA_CONV = "openConv"
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannels()
        startFg()
        // reconnect the moment the network comes back (after Doze cut it / wifi↔流量切换) —
        // the 5s retry timer is frozen while the device sleeps, this callback isn't
        try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            netCb = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { handler.post { if (!stopped) { fails = 0; connect() } } }
            }
            cm.registerDefaultNetworkCallback(netCb!!)
        } catch (e: Exception) {}
        connect()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    // some ROMs kill the process when the app's task is swiped away — schedule the service's own
    // revival so the wake channel survives a swipe (START_STICKY alone is often not honored there)
    override fun onTaskRemoved(rootIntent: Intent?) {
        try {
            val pi = PendingIntent.getForegroundService(
                this, 1, Intent(this, NotifyService::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT
            )
            val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + 3000, pi)
        } catch (e: Exception) {}
        super.onTaskRemoved(rootIntent)
    }

    private fun startFg() {
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(FG_ID, ongoingNotif(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(FG_ID, ongoingNotif())
        } catch (e: Exception) { /* if FGS start is blocked, the service still tries to run */ }
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CH_ONGOING, "后台守候", NotificationManager.IMPORTANCE_MIN))
            val wake = NotificationChannel(CH_WAKE, "唤醒消息", NotificationManager.IMPORTANCE_HIGH)
            wake.enableVibration(true)
            nm.createNotificationChannel(wake)
        }
    }

    private fun ongoingNotif(): Notification {
        val pi = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CH_ONGOING)
            .setContentTitle("Telos 守候中")
            .setContentText("保持连接以接收唤醒")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
    }

    private fun connect() {
        if (stopped) return
        val sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val url = sp.getString("ws_url", "") ?: ""
        val token = sp.getString("token", "") ?: ""
        if (url.isEmpty() || token.isEmpty()) { scheduleReconnect(); return }
        try { ws?.cancel() } catch (e: Exception) {}
        if (client == null) client = OkHttpClient.Builder()
            .pingInterval(40, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
        val req = Request.Builder().url(url).build()
        ws = client!!.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                fails = 0
                webSocket.send(JSONObject().put("type", "auth").put("token", token).toString())
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val o = JSONObject(text)
                    if (o.optString("type") == "wake_message" && !AppState.foreground) {
                        showWake(o.optString("sessionId"), o.optString("title"), o.optString("text"))
                    }
                } catch (e: Exception) {}
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { scheduleReconnect() }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { scheduleReconnect() }
        })
    }

    private fun scheduleReconnect() {
        if (stopped) return
        handler.removeCallbacksAndMessages(null)
        // back off when the bridge is genuinely unreachable (5s→10→20→40→60 cap) instead of
        // burning battery on a dead link; resets on success and on network-available
        val delay = (5000L shl minOf(fails, 4)).coerceAtMost(60000L)
        fails += 1
        handler.postDelayed({ connect() }, delay)
    }

    private fun showWake(sid: String, title: String, text: String) {
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra(EXTRA_CONV, sid)
        }
        val pi = PendingIntent.getActivity(
            this, if (sid.isEmpty()) 1 else sid.hashCode(), intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val body = if (text.isEmpty()) "你有一条新消息" else text
        val n = NotificationCompat.Builder(this, CH_WAKE)
            .setContentTitle(if (title.isNotEmpty()) title else "Telos")
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pi)
            .build()
        try { getSystemService(NotificationManager::class.java).notify(nextId++, n) } catch (e: Exception) {}
    }

    override fun onDestroy() {
        stopped = true
        handler.removeCallbacksAndMessages(null)
        try { netCb?.let { (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(it) } } catch (e: Exception) {}
        try { ws?.close(1000, null) } catch (e: Exception) {}
        super.onDestroy()
    }
}
