/**
 * Expo config plugin to fix @react-native-voice/voice for Gradle 9+ / AGP 8+
 *
 * Problems:
 * 1. Library uses jcenter() which is removed in Gradle 9 → replace with mavenCentral()
 * 2. Library doesn't specify compileSdk → add it (required by newer AGP)
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

      let contents = fs.readFileSync(voiceBuildGradle, 'utf-8');

      // Fix 1: Replace jcenter() with mavenCentral()
      contents = contents.replace(/jcenter\(\)/g, 'mavenCentral()');

      // Fix 2: Add compileSdk if missing
      if (!contents.includes('compileSdk') && !contents.includes('compileSdkVersion')) {
        // Insert compileSdkVersion into the android { } block
        contents = contents.replace(
          /android\s*\{/,
          'android {\n    compileSdkVersion 34',
        );
      }

      fs.writeFileSync(voiceBuildGradle, contents, 'utf-8');
      console.log('[withVoiceFix] Patched @react-native-voice/voice build.gradle');

      return config;
    },
  ]);
};
