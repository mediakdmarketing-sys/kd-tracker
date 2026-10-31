plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The server the app talks to. Override at build time with
//   gradle assembleDebug -PapiBaseUrl=https://api.example.com -PportalUrl=https://app.example.com
val apiBaseUrl = (project.findProperty("apiBaseUrl") as String?) ?: "https://kd-tracker.onrender.com"
val portalUrl = (project.findProperty("portalUrl") as String?) ?: "https://kd-tracker-three.vercel.app"

// Where the app looks for a newer APK: a folder holding `version.json` and the APK (see
// .github/workflows/build-android.yml). Empty turns the update check off.
val updateUrl = (project.findProperty("updateUrl") as String?) ?: ""
// CI raises versionCode on every build; Android refuses to install an APK that is not higher.
val appVersionCode = ((project.findProperty("versionCode") as String?) ?: "1").toInt()
val appVersionName = (project.findProperty("versionName") as String?) ?: "0.1.0"

android {
    namespace = "com.kdmarketing.workbuddy"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.kdmarketing.workbuddy"
        // 29: MediaRecorder can write Ogg/Opus from here, which is a format the server accepts.
        minSdk = 29
        targetSdk = 34
        versionCode = appVersionCode
        versionName = appVersionName

        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
        buildConfigField("String", "PORTAL_URL", "\"$portalUrl\"")
        buildConfigField("String", "UPDATE_URL", "\"$updateUrl\"")
    }

    // An update only installs over the old app if both were signed with the same key. A debug
    // build uses a debug key that CI generates fresh on every run, so CI supplies one fixed
    // keystore instead (ANDROID_KEYSTORE_PATH and friends). Without them the normal debug key is used.
    val keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
    if (!keystorePath.isNullOrEmpty()) {
        signingConfigs {
            create("shared") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            if (!keystorePath.isNullOrEmpty()) signingConfig = signingConfigs.getByName("shared")
        }
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
