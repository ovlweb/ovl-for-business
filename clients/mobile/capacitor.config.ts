import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android & iOS shell. The UI is the regular web client build (clients/web/dist).
 * Build the web client with VITE_API_URL=https://your-server so the app knows
 * where the API lives (users can also change the server on the sign-in screen).
 */
const config: CapacitorConfig = {
  appId: 'com.ovl.business',
  appName: 'OVL Business',
  webDir: '../web/dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#0f131a',
    },
  },
};

export default config;
