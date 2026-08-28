import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jobtrackos.app',
  appName: 'JobTrackOS',
  webDir: 'out',
  server: {
    url: 'https://jobtrackos.online',
    cleartext: false
  }
};

export default config;
