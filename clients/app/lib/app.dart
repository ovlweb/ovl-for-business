import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'screens/applications.dart';
import 'screens/auth.dart';
import 'screens/chats.dart';
import 'screens/companies.dart';
import 'screens/contacts.dart';
import 'screens/exchange.dart';
import 'screens/home.dart';
import 'screens/onboarding.dart';
import 'screens/registry.dart';
import 'screens/review.dart';
import 'screens/settings.dart';
import 'screens/shell.dart';
import 'screens/splash.dart';
import 'screens/support.dart';
import 'screens/invoices.dart';
import 'screens/wallet.dart';
import 'state/session.dart';
import 'theme/theme_controller.dart';

final rootNavigatorKey = GlobalKey<NavigatorState>();

bool isWide(BuildContext context) => MediaQuery.sizeOf(context).width >= 900;

/// Split views (chat list + conversation) open details without an animation on wide screens.
Page<void> detailPage(BuildContext context, GoRouterState state, Widget child) => isWide(context)
    ? NoTransitionPage(key: state.pageKey, child: child)
    : MaterialPage(key: state.pageKey, child: child);

GoRouter buildRouter(Session session, String? initialRoute) {
  String? pending = initialRoute;
  return GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: '/splash',
    refreshListenable: session,
    redirect: (context, state) {
      final at = state.matchedLocation;
      if (session.loading && session.me == null) return at == '/splash' ? null : '/splash';
      final me = session.me;
      if (me == null || session.addingAccount) return at == '/login' ? null : '/login';
      if (!me.preferences.onboardingCompleted) return at == '/welcome' ? null : '/welcome';
      if (at == '/splash' || at == '/login' || at == '/welcome') {
        final target = pending ?? '/home';
        pending = null;
        return target;
      }
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/welcome', builder: (_, _) => const OnboardingScreen()),
      GoRoute(
        path: '/u/:username',
        parentNavigatorKey: rootNavigatorKey,
        builder: (_, s) => ProfileScreen(username: s.pathParameters['username']!),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell, location: state.uri.path),
        branches: [
          for (final section in sections) StatefulShellBranch(routes: [section.route]),
        ],
      ),
    ],
  );
}

/// One entry of the navigation (sidebar on desktop, bottom bar + "More" on phones).
class Section {
  const Section(
    this.path,
    this.label,
    this.icon,
    this.group,
    this.route, {
    this.primary = false,
    this.permission,
    this.staffOnly = false,
  });

  final String path;
  final String label;
  final IconData icon;
  final String group;
  final GoRoute route;
  final bool primary;
  final String? permission;
  final bool staffOnly;
}

final sections = <Section>[
  Section(
    '/home',
    'Home',
    navIcons['home']!,
    'Workspace',
    GoRoute(path: '/home', builder: (_, _) => const HomeScreen()),
    primary: true,
  ),
  Section(
    '/chats',
    'Chats',
    navIcons['chats']!,
    'Workspace',
    GoRoute(
      path: '/chats',
      builder: (_, _) => const ChatsScreen(),
      routes: [
        GoRoute(
          path: ':id',
          pageBuilder: (c, s) => detailPage(c, s, ChatsScreen(selectedId: s.pathParameters['id'])),
        ),
      ],
    ),
    primary: true,
  ),
  Section(
    '/contacts',
    'Contacts',
    navIcons['contacts']!,
    'Workspace',
    GoRoute(path: '/contacts', builder: (_, _) => const ContactsScreen()),
  ),
  Section(
    '/wallet',
    'Wallet',
    navIcons['wallet']!,
    'Finance',
    GoRoute(path: '/wallet', builder: (_, _) => const WalletScreen()),
    primary: true,
  ),
  Section(
    '/invoices',
    'Invoices',
    navIcons['invoices']!,
    'Finance',
    GoRoute(path: '/invoices', builder: (_, _) => const InvoicesScreen()),
  ),
  Section(
    '/companies',
    'Companies',
    navIcons['companies']!,
    'Finance',
    GoRoute(
      path: '/companies',
      builder: (_, _) => const CompaniesScreen(),
      routes: [
        GoRoute(
          path: ':slug',
          builder: (_, s) => CompanyScreen(slug: s.pathParameters['slug']!),
        ),
      ],
    ),
  ),
  Section(
    '/exchange',
    'Exchange',
    navIcons['exchange']!,
    'Finance',
    GoRoute(
      path: '/exchange',
      builder: (_, _) => const ExchangeScreen(),
      routes: [
        GoRoute(path: 'portfolio', builder: (_, _) => const PortfolioScreen()),
        GoRoute(
          path: ':ticker',
          builder: (_, s) => ListingScreen(ticker: s.pathParameters['ticker']!),
        ),
      ],
    ),
    primary: true,
  ),
  Section(
    '/registry',
    'Public registry',
    navIcons['registry']!,
    'Registry',
    GoRoute(
      path: '/registry',
      builder: (_, s) => RegistryScreen(initialQuery: s.uri.queryParameters['q']),
    ),
  ),
  Section(
    '/applications',
    'Applications',
    navIcons['applications']!,
    'Registry',
    GoRoute(
      path: '/applications',
      builder: (_, _) => const ApplicationsScreen(),
      routes: [
        GoRoute(
          path: 'new/:type',
          builder: (_, s) => NewApplicationScreen(type: s.pathParameters['type']!),
        ),
      ],
    ),
  ),
  Section(
    '/support',
    'Tech support',
    navIcons['support']!,
    'Help',
    GoRoute(
      path: '/support',
      builder: (_, _) => const SupportScreen(),
      routes: [
        GoRoute(
          path: ':id',
          pageBuilder: (c, s) => detailPage(c, s, SupportScreen(selectedId: s.pathParameters['id'])),
        ),
      ],
    ),
  ),
  Section(
    '/review',
    'Review queue',
    navIcons['review']!,
    'Staff',
    GoRoute(
      path: '/review',
      builder: (_, _) => const ReviewScreen(),
      routes: [
        GoRoute(
          path: ':id',
          builder: (_, s) => ReviewDetailScreen(id: s.pathParameters['id']!),
        ),
      ],
    ),
    staffOnly: true,
  ),
  Section(
    '/settings',
    'Settings',
    navIcons['settings']!,
    'Account',
    GoRoute(
      path: '/settings',
      builder: (_, s) => SettingsScreen(section: s.uri.queryParameters['section']),
    ),
  ),
];

class OvlApp extends StatefulWidget {
  const OvlApp({super.key, required this.session, this.initialRoute});

  final Session session;
  final String? initialRoute;

  @override
  State<OvlApp> createState() => _OvlAppState();
}

class _OvlAppState extends State<OvlApp> {
  late final GoRouter _router = buildRouter(widget.session, widget.initialRoute);

  @override
  Widget build(BuildContext context) {
    final themes = context.watch<ThemeController>();
    return MaterialApp.router(
      title: 'OVL For Business',
      debugShowCheckedModeBanner: false,
      theme: themes.theme,
      themeAnimationDuration: Duration.zero,
      scrollBehavior: const DesktopScrollBehavior(),
      routerConfig: _router,
      builder: (context, child) => ThemeReveal(
        key: themes.revealKey,
        child: IncomingMessages(router: _router, child: child ?? const SizedBox()),
      ),
    );
  }
}

/// Slides a banner in when a message arrives for a chat that is not on screen.
class IncomingMessages extends StatefulWidget {
  const IncomingMessages({super.key, required this.child, required this.router});

  final Widget child;
  final GoRouter router;

  @override
  State<IncomingMessages> createState() => _IncomingMessagesState();
}

class _IncomingMessagesState extends State<IncomingMessages> {
  StreamSubscription<IncomingMessage>? _sub;
  IncomingMessage? _current;
  Timer? _hide;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sub ??= context.read<Session>().incoming.listen((m) {
      _hide?.cancel();
      setState(() => _current = m);
      _hide = Timer(const Duration(seconds: 4), () => mounted ? setState(() => _current = null) : null);
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _hide?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final m = _current;
    return Stack(
      children: [
        widget.child,
        Positioned(
          left: 12,
          right: 12,
          top: 0,
          child: SafeArea(
            child: Align(
              alignment: Alignment.topCenter,
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 350),
                switchInCurve: Curves.easeOutBack,
                transitionBuilder: (child, a) => SlideTransition(
                  position: Tween(begin: const Offset(0, -1.4), end: Offset.zero).animate(a),
                  child: FadeTransition(opacity: a, child: child),
                ),
                child: m == null
                    ? const SizedBox.shrink()
                    : ConstrainedBox(
                        key: ValueKey(m.message.id),
                        constraints: const BoxConstraints(maxWidth: 440),
                        child: Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: MessageBanner(
                            incoming: m,
                            onTap: () {
                              setState(() => _current = null);
                              final support = m.chat == null || m.chat!.type == 'support';
                              widget.router.go(support ? '/support/${m.message.chatId}' : '/chats/${m.message.chatId}');
                            },
                          ),
                        ),
                      ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
