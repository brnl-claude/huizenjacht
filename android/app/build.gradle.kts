// Huizenjacht for Android: opens the Huizenjacht PWA on your own server full screen, in
// Chrome's engine as a Trusted Web Activity (with Chrome's login and cookies), or in the
// app's own WebView on a device without such a browser. The server address is set in the
// app (SetupActivity), not here, so one APK works for any server.

plugins {
    id("com.android.application")
}

// The PWA's version from frontend/src/changelog.ts, such as 0.7.0, given by CI (see
// .github/workflows/ci.yml). The version code follows from it, so every release installs
// over the one before: 1.2.3 → 1002003.
val versionNameFromCi = System.getenv("HJ_VERSION")?.removePrefix("v")
val semver = Regex("""(\d+)\.(\d+)\.(\d+)""").matchEntire(versionNameFromCi ?: "")
val versionCodeFromSemver = semver?.destructured?.let { (major, minor, patch) ->
    require(minor.toInt() < 1000 && patch.toInt() < 1000) { "Minor and patch must stay below 1000" }
    major.toInt() * 1_000_000 + minor.toInt() * 1_000 + patch.toInt()
}

android {
    namespace = "app.huizenjacht"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.huizenjacht"
        minSdk = 24
        targetSdk = 36
        versionCode = versionCodeFromSemver ?: 1
        versionName = versionNameFromCi ?: "dev"

        resValue("string", "defaultServer", providers.gradleProperty("hj.defaultServer").get())
    }

    buildFeatures {
        resValues = true
    }

    signingConfigs {
        // The release key comes from the environment (CI secrets, see android/README.md).
        val keystore = System.getenv("ANDROID_KEYSTORE")
        if (!keystore.isNullOrEmpty()) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
    implementation("androidx.core:core:1.17.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.webkit:webkit:1.12.1")
}
