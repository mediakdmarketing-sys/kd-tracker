plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The server the app talks to. Override at build time with
//   gradle assembleDebug -PapiBaseUrl=https://api.example.com -PportalUrl=https://app.example.com
val apiBaseUrl = (project.findProperty("apiBaseUrl") as String?) ?: "https://kd-tracker.onrender.com"
val portalUrl = (project.findProperty("portalUrl") as String?) ?: "https://kd-tracker-three.vercel.app"

android {
    namespace = "com.kdmarketing.workbuddy"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.kdmarketing.workbuddy"
        // 29: MediaRecorder can write Ogg/Opus from here, which is a format the server accepts.
        minSdk = 29
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
        buildConfigField("String", "PORTAL_URL", "\"$portalUrl\"")
    }

    buildTypes {
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
