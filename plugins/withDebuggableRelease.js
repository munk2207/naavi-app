/**
 * Expo Config Plugin — Debuggable Release Build
 *
 * Injected automatically during EAS build. Do NOT hand-edit android/.
 *
 * Purpose:
 *   Modern React Native suppresses JS-bundle embedding when buildType=debug
 *   (the gradle plugin assumes Metro will serve the bundle). That makes a
 *   sideloadable debug APK impossible without complicated workarounds.
 *
 *   This plugin flips the Android `debuggable` flag on the RELEASE buildType
 *   when EXPO_DEBUGGABLE_RELEASE=true is set. Result:
 *     - JS bundle gets embedded (release variant → bundle task runs)
 *     - BuildConfig.DEBUG = true at compile time (AGP honors `debuggable`)
 *     - Native libraries that gate behavior on BuildConfig.DEBUG see DEBUG=true
 *
 *   Effectively a release APK that identifies itself as a debug build to
 *   the running app, so we can sideload it AND test debug-only library code
 *   paths (e.g. Transistorsoft's free unlicensed mode).
 *
 * Activation:
 *   Only runs when EXPO_DEBUGGABLE_RELEASE=true. The env var lives in the
 *   `trial-debug` EAS profile so normal preview/production builds are
 *   unaffected.
 */

const { withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withDebuggableRelease(config) {
  return withAppBuildGradle(config, (config) => {
    if (process.env.EXPO_DEBUGGABLE_RELEASE !== 'true') {
      return config;
    }

    let src = config.modResults.contents;

    // Inject `debuggable true` + `jniDebuggable true` immediately after
    // the `minifyEnabled` line inside the release { ... } block.
    const patched = src.replace(
      /(release\s*\{[^}]*?)(minifyEnabled[^\n]*\n)/s,
      (m, head, minify) =>
        head + minify + '            debuggable true\n            jniDebuggable true\n',
    );

    if (patched === src) {
      console.warn('[withDebuggableRelease] could not find release block — buildType not patched');
      return config;
    }

    config.modResults.contents = patched;
    console.log('[withDebuggableRelease] release buildType marked debuggable=true');
    return config;
  });
};
