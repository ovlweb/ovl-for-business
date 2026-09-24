# OVL For Business — native app

One Flutter code base compiled to real native apps: **Android, iOS, macOS, Windows and Linux**.
It is not a web view. Screens, animations and the chart are drawn natively, and every
platform folder (`android/`, `ios/`, `macos/`, `windows/`, `linux/`) opens in its own IDE
(Android Studio, Xcode, Visual Studio or any CMake IDE).

## Features

- **Animated sign-in** with a live brand panel on large screens, registration with a password
  strength meter, saved accounts and a custom server address for self-hosted deployments.
- **Multi-account.** Several accounts are signed in on one device and you switch in one tap.
  Refresh tokens live in the platform keychain (Keychain, Keystore, Credential Manager or
  libsecret).
- **First-run tour** covering theme, profile and goals, with shortcuts into the app.
- **Themes.** The eight themes are shared with the web client. They are generated from
  `packages/shared/src/themes.ts`, reveal with an animated circle, and follow your account
  across devices.
- **Adaptive layout.** Phones get a bottom bar with a "More" sheet. Tablets and desktops get a
  sidebar, split views for chats and support, and a Ctrl/⌘ + K search palette.
- **Screens:**
  - Home dashboard
  - Chats: realtime, typing, replies, edit and delete, groups and channels
  - Contacts and profiles
  - Wallet: bank cards, statement, transfers
  - Companies
  - Stock exchange: interactive price chart, investing, portfolio
  - Public registry
  - Applications with approval steppers
  - Tech support, including the staff desk
  - Staff review queue with checklists
  - Service stories
  - Settings
- **In-app banners** for messages that arrive in other chats.

## Run

```bash
flutter pub get
flutter run                                   # pick a device: phone, emulator or desktop
flutter run -d linux --dart-define=OVL_API_URL=http://localhost:4000
```

The default server is `http://localhost:4000`. The Android emulator uses `http://10.0.2.2:4000`
to reach your machine. You can change the server on the sign-in screen or in
Settings → Server, and bake in a default with `--dart-define=OVL_API_URL=…`.

Desktop builds accept `--route=/wallet` (or any other screen) to open a screen directly. On
Linux, `OVL_WINDOW_SIZE=390x844` sets the initial window size.

## Build

```bash
flutter build apk --release        # Android
flutter build ios --release        # iOS (on macOS, with signing)
flutter build macos --release      # macOS
flutter build windows --release    # Windows
flutter build linux --release      # Linux (needs clang, cmake, ninja, GTK 3, libsecret)
```

CI (`.github/workflows/native.yml`) runs `flutter analyze`, `dart format` and `flutter test`,
checks that the generated Dart files are up to date, and builds all five platforms.

## Code

```
lib/
  api/        models, HTTP client (token refresh), realtime WebSocket, currencies.g.dart
  state/      accounts (multi-account + keychain), session, query cache
  theme/      palettes.g.dart (generated), ThemeData, theme controller with circular reveal
  ui/         widgets, chart, theme gallery, formatting
  screens/    one file per area (auth, onboarding, shell, home, chats, wallet, …)
```

Generated files come from the TypeScript sources. After changing themes or currencies, run
`pnpm gen:dart` at the repository root. To regenerate the launcher icons from
`assets/icon/`, run `dart run flutter_launcher_icons`.
