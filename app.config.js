const isStaging = process.env.APP_VARIANT === 'staging';

module.exports = ({ config }) => ({
  ...config,
  name: isStaging ? 'Naavi Staging' : config.name,
  android: {
    ...config.android,
    package: isStaging ? 'ca.naavi.app.staging' : config.android.package,
  },
});
