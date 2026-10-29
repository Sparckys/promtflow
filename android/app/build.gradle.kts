// GuionFlow para tablets Android. La interfaz es la misma de la versión de escritorio:
// los archivos de desktop/src/renderer se empaquetan tal cual dentro del APK.
plugins {
    id("com.android.application")
}

val appVersion = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
    .find(file("../../desktop/package.json").readText())!!.groupValues[1]
val versionParts = appVersion.split(".").map { it.toInt() }

android {
    namespace = "com.guionflow.tablet"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.guionflow.tablet"
        minSdk = 26
        targetSdk = 35
        versionName = appVersion
        versionCode = versionParts[0] * 10000 + versionParts[1] * 100 + versionParts[2]
    }

    // La firma viene de los secretos de GitHub (ver .github/workflows/android.yml).
    // Sin ellos (compilación local) se usa la firma de depuración.
    val keystorePath = System.getenv("GF_KEYSTORE")
    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storeType = "pkcs12"
                storePassword = System.getenv("GF_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("GF_KEY_ALIAS") ?: "guionflow"
                keyPassword = System.getenv("GF_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystorePath != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    sourceSets {
        getByName("main") {
            assets.srcDirs("src/main/assets", "../../desktop/src/renderer")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
