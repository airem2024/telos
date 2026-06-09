import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// --- local, never-committed config. Falls back to safe defaults so a fresh clone / a CI run
// --- without secrets still builds a self-contained, debug-key-signed APK. ---
// Signing: app/keystore.properties (gitignored) or env SIGNING_STORE_PASSWORD / SIGNING_KEY_PASSWORD
//          / SIGNING_KEY_ALIAS. If absent → no custom signingConfig → Gradle's default debug key.
val keystoreProps = Properties().apply {
    val f = file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signCfg(key: String, env: String): String =
    keystoreProps.getProperty(key) ?: System.getenv(env) ?: ""
val storePw = signCfg("storePassword", "SIGNING_STORE_PASSWORD")
val keyPw = signCfg("keyPassword", "SIGNING_KEY_PASSWORD")
val keyAliasName = signCfg("keyAlias", "SIGNING_KEY_ALIAS").ifBlank { "telos" }
val keystoreFile = file("telos.keystore")
val hasSigning = keystoreFile.exists() && storePw.isNotBlank() && keyPw.isNotBlank()

// Where the WebView loads its UI from. Empty → bundled assets (self-contained). Set your own
// bridge here to live-serve / hot-reload the front-end: local.properties `telos.remoteUrl=...`
// or env TELOS_REMOTE_URL (CI: a repo variable).
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val remoteUrl = (localProps.getProperty("telos.remoteUrl") ?: System.getenv("TELOS_REMOTE_URL") ?: "")

android {
    namespace = "app.telos.claudeterm"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.telos.claudeterm"
        minSdk = 26
        targetSdk = 34
        // CI stamps these via sed before building (see .github/workflows/build.yml)
        versionCode = 3
        versionName = "1.1.1"
        buildConfigField("String", "REMOTE_URL", "\"$remoteUrl\"")
    }

    signingConfigs {
        if (hasSigning) create("stable") {
            storeFile = keystoreFile
            storePassword = storePw
            keyAlias = keyAliasName
            keyPassword = keyPw
        }
    }

    buildTypes {
        debug {
            if (hasSigning) signingConfig = signingConfigs.getByName("stable")
        }
        release {
            isMinifyEnabled = false
            if (hasSigning) signingConfig = signingConfigs.getByName("stable")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0") // background WebSocket for wake notifications
}
