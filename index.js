import 'expo-router/entry';
import BackgroundGeolocation from 'react-native-background-geolocation';
import { handleGeofenceEvent } from './hooks/useGeofencing';

const HeadlessTask = async (event) => {
  try {
    if (event?.name === 'geofence' && event?.params) {
      await handleGeofenceEvent(event.params);
    }
  } catch (err) {
    console.error('[headless-task] failed:', err);
  }
};

BackgroundGeolocation.registerHeadlessTask(HeadlessTask);
