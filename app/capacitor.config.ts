import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.unreel.app',
  appName: 'Unreel',
  webDir: 'dist/app/browser',
  server: {
    // The API runs over plain http on the local network, so the WebView
    // must also be http and cleartext traffic must be allowed.
    androidScheme: 'http',
    cleartext: true,
  },
};

export default config;
