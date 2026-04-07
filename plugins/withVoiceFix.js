/**
 * Expo config plugin to fix @react-native-voice/voice for Gradle 9+ / AGP 8+
 *
 * The library's build.gradle is stuck on 2019-era defaults:
 * 1. Uses jcenter() (removed in Gradle 9)
 * 2. Uses compileSdkVersion (needs compileSdk for AGP 8+)
 * 3. Uses com.android.support:appcompat-v7 (conflicts with AndroidX)
 * 4. Has a buildscript block with old AGP 3.3.2
 *
 * This plugin rewrites the entire build.gradle to a modern, minimal version
 * that works with Expo SDK 55 / React Native 0.83 / Gradle 9.
 */

const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withVoiceFix(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const voiceBuildGradle = path.join(
        config.modRequest.projectRoot,
        'node_modules',
        '@react-native-voice',
        'voice',
        'android',
        'build.gradle',
      );

      if (!fs.existsSync(voiceBuildGradle)) {
        console.warn('[withVoiceFix] build.gradle not found, skipping patch');
        return config;
      }

      // Replace the entire build.gradle with a modern version
      const modernBuildGradle = `
apply plugin: 'com.android.library'

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

      fs.writeFileSync(voiceBuildGradle, modernBuildGradle, 'utf-8');
      console.log('[withVoiceFix] Rewrote @react-native-voice/voice build.gradle for Gradle 9+');

      return config;
    },
  ]);
};
