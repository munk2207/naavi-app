const isStaging = process.env.APP_VARIANT === 'staging';

// Staging uses same package name (ca.naavi.app) as production because
// google-services.json is tied to that package. The backend is isolated
// via EXPO_PUBLIC_SUPABASE_URL pointing at the staging Supabase project.
// Cannot have both staging and production installed simultaneously —
// uninstall production before installing staging APK.
module.exports = ({ config }) => ({
  ...config,
  name: isStaging ? 'Naavi Staging' : config.name,
});
