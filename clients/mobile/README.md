# OVL Business — Android & iOS

The mobile apps are a [Capacitor](https://capacitorjs.com) shell around the web client
(`clients/web`), so every feature ships to web, Android and iOS from one codebase.

## Requirements

- Android: Android Studio (SDK 35+, JDK 21)
- iOS: macOS with Xcode 16+ and CocoaPods

## First run

```bash
pnpm install
# Point the app at your server (or let users type it on the sign-in screen):
export VITE_API_URL=https://business.example.com

pnpm --filter @ovl/mobile add:android     # generates clients/mobile/android (once)
pnpm --filter @ovl/mobile add:ios         # generates clients/mobile/ios (once, macOS)
pnpm --filter @ovl/mobile sync            # builds the web client and copies it into the native projects
pnpm --filter @ovl/mobile open:android    # or open:ios, then build / run from the IDE
```

The generated `android/` and `ios/` folders are ignored by git until you decide to
customise them (icons, push notifications, signing). Remove them from `.gitignore`
once you start editing native code.

## Server address

The API origin is taken from, in order: the server saved on the sign-in screen,
`VITE_API_URL` at build time. Remember to allow the app origin in the server's
`CORS_ORIGINS` (`https://localhost` for Android, `capacitor://localhost` for iOS).
