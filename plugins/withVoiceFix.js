/**
 * Expo config plugin to fix @react-native-voice/voice for Expo SDK 55+ / RN 0.83+
 *
 * Three fixes:
 * 1. Rewrites build.gradle for Gradle 9+ (removes jcenter, old support lib, etc.)
 * 2. Patches MainApplication to manually register VoicePackage
 *    (Expo's auto-linking doesn't find this library — NativeModules.Voice is null)
 */

const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withVoiceFix(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;

      // ── Fix 1: Rewrite build.gradle ─────────────────────────────────
      const voiceBuildGradle = path.join(
        projectRoot,
        'node_modules',
        '@react-native-voice',
        'voice',
        'android',
        'build.gradle',
      );

      if (fs.existsSync(voiceBuildGradle)) {
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
        fs.writeFileSync(voiceBuildGradle, modernBuildGradle, 'utf-8');
        console.log('[withVoiceFix] Rewrote build.gradle for Gradle 9+');
      }

      // ── Fix 2: Register VoicePackage in MainApplication ─────────────
      // Expo's auto-linking doesn't find this library, so we add it manually.
      const mainAppDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java');

      // Find MainApplication.java (or .kt) recursively
      const findFile = (dir, filename) => {
        if (!fs.existsSync(dir)) return null;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const found = findFile(fullPath, filename);
            if (found) return found;
          } else if (entry.name === filename) {
            return fullPath;
          }
        }
        return null;
      };

      const mainAppJava = findFile(mainAppDir, 'MainApplication.java');
      const mainAppKt = findFile(mainAppDir, 'MainApplication.kt');
      const mainAppPath = mainAppJava || mainAppKt;

      if (mainAppPath) {
        let contents = fs.readFileSync(mainAppPath, 'utf-8');
        const isKotlin = mainAppPath.endsWith('.kt');

        // Check if already patched
        if (!contents.includes('VoicePackage')) {
          // Add import
          const importLine = isKotlin
            ? 'import com.wenkesj.voice.VoicePackage'
            : 'import com.wenkesj.voice.VoicePackage;';

          // Insert import after last import line
          const importRegex = isKotlin
            ? /(import [^\n]+\n)(?!import)/
            : /(import [^\n]+;\n)(?!import)/;

          // Find the last import block
          const lines = contents.split('\n');
          let lastImportIdx = -1;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith('import ')) {
              lastImportIdx = i;
            }
          }

          if (lastImportIdx >= 0) {
            lines.splice(lastImportIdx + 1, 0, importLine);
            contents = lines.join('\n');
          }

          // Add package to getPackages()
          // Look for the packages list and add VoicePackage
          if (isKotlin) {
            // Kotlin: look for packages list pattern
            contents = contents.replace(
              /override fun getPackages\(\): List<ReactPackage> \{/,
              `override fun getPackages(): List<ReactPackage> {\n            packages.add(VoicePackage())`
            );
            // Alternative: PackageList pattern
            if (!contents.includes('packages.add(VoicePackage())')) {
              contents = contents.replace(
                /val packages = PackageList\(this\)\.packages/,
                `val packages = PackageList(this).packages\n            packages.add(VoicePackage())`
              );
            }
          } else {
            // Java: look for PackageList pattern
            contents = contents.replace(
              /List<ReactPackage> packages = new PackageList\(this\)\.getPackages\(\);/,
              `List<ReactPackage> packages = new PackageList(this).getPackages();\n            packages.add(new VoicePackage());`
            );
          }

          fs.writeFileSync(mainAppPath, contents, 'utf-8');
          console.log('[withVoiceFix] Registered VoicePackage in MainApplication');
        } else {
          console.log('[withVoiceFix] VoicePackage already registered');
        }
      } else {
        console.warn('[withVoiceFix] MainApplication not found — android/ may not be generated yet');
      }

      // ── Fix 3: Add to settings.gradle for Gradle to find the project ──
      const settingsGradle = path.join(projectRoot, 'android', 'settings.gradle');
      if (fs.existsSync(settingsGradle)) {
        let settings = fs.readFileSync(settingsGradle, 'utf-8');
        if (!settings.includes(':react-native-voice_voice')) {
          const includeLines = `
include ':react-native-voice_voice'
project(':react-native-voice_voice').projectDir = new File(rootProject.projectDir, '../node_modules/@react-native-voice/voice/android')
`;
          settings += includeLines;
          fs.writeFileSync(settingsGradle, settings, 'utf-8');
          console.log('[withVoiceFix] Added react-native-voice to settings.gradle');
        }
      }

      // ── Fix 4: Add dependency in app/build.gradle ──────────────────────
      const appBuildGradle = path.join(projectRoot, 'android', 'app', 'build.gradle');
      if (fs.existsSync(appBuildGradle)) {
        let appGradle = fs.readFileSync(appBuildGradle, 'utf-8');
        if (!appGradle.includes(':react-native-voice_voice')) {
          appGradle = appGradle.replace(
            /dependencies\s*\{/,
            `dependencies {\n    implementation project(':react-native-voice_voice')`
          );
          fs.writeFileSync(appBuildGradle, appGradle, 'utf-8');
          console.log('[withVoiceFix] Added react-native-voice dependency to app/build.gradle');
        }
      }

      return config;
    },
  ]);
};
