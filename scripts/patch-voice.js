/**
 * Patches @react-native-voice/voice build.gradle for Gradle 9+ / AGP 8+
 * Runs automatically after npm install via postinstall script.
 */
const fs = require('fs');
const path = require('path');

const buildGradlePath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@react-native-voice',
  'voice',
  'android',
  'build.gradle',
);

if (!fs.existsSync(buildGradlePath)) {
  console.log('[patch-voice] @react-native-voice/voice not installed yet, skipping');
  process.exit(0);
}

const modernBuildGradle = `apply plugin: 'com.android.library'

android {
    compileSdk rootProject.ext.has('compileSdkVersion') ? rootProject.ext.compileSdkVersion : 34

    defaultConfig {
        minSdkVersion rootProject.ext.has('minSdkVersion') ? rootProject.ext.minSdkVersion : 24
        targetSdkVersion rootProject.ext.has('targetSdkVersion') ? rootProject.ext.targetSdkVersion : 34
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}

dependencies {
    implementation 'com.facebook.react:react-native:+'
}
`;

fs.writeFileSync(buildGradlePath, modernBuildGradle, 'utf-8');
console.log('[patch-voice] Patched @react-native-voice/voice build.gradle for Gradle 9+');
