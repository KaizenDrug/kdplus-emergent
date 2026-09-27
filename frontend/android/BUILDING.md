# Build the KDPlus POS Android APK

This Android app opens the existing KDPLUS interface at the pharmacy's private Tailscale address. Sales, products, and other records continue to live on the Mac/PC backend.

## Requirements

- Android Studio with Android SDK Platform 35 and a Java 17 JDK
- The KDPLUS Mac/PC server running with Tailscale Serve enabled
- The Android tablet signed into the same Tailscale network

## Build a debug APK on the Mac

From Terminal:

```sh
cd ~/Documents/kdplus-emergent/frontend
yarn install
yarn android:build
```

The APK will be at:

```text
frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

You can also open the native project in Android Studio with `yarn android:open`, then choose **Build > Build Bundle(s) / APK(s) > Build APK(s)**.

## Install on the tablet

Copy `app-debug.apk` to the tablet and open it. Android may ask you to allow installation from that file manager. Keep Tailscale connected and the Mac/PC server running when using KDPLUS.

## Tailscale address

The app currently opens `https://ralps-macbook-pro.tailfd147f.ts.net/`. If the server's Tailscale name changes, update `server.url` and `server.allowNavigation` in `capacitor.config.json`, then rebuild the APK.

This wrapper loads the live KDPLUS site, so it needs a network connection to the server. It does not make the Android tablet a database server or add offline sales synchronization.
