// The APK is a thin shell that loads the live app, so every website deploy updates the agents' app too.
// ponytail: only native changes (new Capacitor plugins, permissions, icon) still need a new APK install.
export default {
  appId: 'in.handoff.recovery',
  appName: 'Handoff Field',
  webDir: 'dist',
  server: {
    url: 'https://handoff.bhodhix.com',
    // Shown only if the very first launch has no connection; after that the service worker serves the cached app.
    errorPath: 'offline.html',
  },
};
