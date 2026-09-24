import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../api/realtime.dart';
import '../theme/theme_controller.dart';
import 'accounts.dart';
import 'query.dart';

/// Default server: the Android emulator reaches the host machine at 10.0.2.2.
String defaultServer() {
  const configured = String.fromEnvironment('OVL_API_URL');
  if (configured.isNotEmpty) return configured;
  if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) return 'http://10.0.2.2:4000';
  return 'http://localhost:4000';
}

/// A message that arrived for a chat that is not on screen.
class IncomingMessage {
  IncomingMessage(this.chat, this.message);
  final Chat? chat;
  final Message message;
}

/// Everything about "who is signed in": accounts, the API client, realtime and caches.
class Session extends ChangeNotifier with WidgetsBindingObserver {
  Session._(this.prefs, this.accounts, this.themes) {
    api = OvlApi(baseUrl: prefs.getString(_serverKey) ?? defaultServer(), tokens: accounts, onSignedOut: _signedOut);
    WidgetsBinding.instance.addObserver(this);
  }

  static const _serverKey = 'ovl.server';

  final SharedPreferences prefs;
  final AccountStore accounts;
  final ThemeController themes;
  late final OvlApi api;
  final QueryClient queries = QueryClient();
  final StreamController<IncomingMessage> _incoming = StreamController.broadcast();
  final StreamController<RealtimeEvent> _events = StreamController.broadcast();
  RealtimeConnection? _realtime;
  StreamSubscription<RealtimeEvent>? _realtimeSub;

  Me? me;
  bool loading = true;
  bool addingAccount = false;

  /// The chat currently open on screen (its messages are not announced).
  String? openChatId;

  static Future<Session> start(SharedPreferences prefs, ThemeController themes) async {
    final accounts = await AccountStore.load(prefs);
    final session = Session._(prefs, accounts, themes);
    await session._loadMe();
    return session;
  }

  String get server => api.baseUrl;
  Stream<IncomingMessage> get incoming => _incoming.stream;
  Stream<RealtimeEvent> get events => _events.stream;
  ValueListenable<RealtimeStatus>? get realtimeStatus => _realtime?.status;

  bool can(String permission) => me?.can(permission) ?? false;

  Future<void> setServer(String url) async {
    final clean = url.trim().replaceAll(RegExp(r'/+$'), '');
    api.baseUrl = clean.isEmpty ? defaultServer() : clean;
    await prefs.setString(_serverKey, api.baseUrl);
    notifyListeners();
  }

  Future<void> _loadMe() async {
    loading = true;
    notifyListeners();
    if (accounts.active == null) {
      me = null;
    } else {
      try {
        final user = await api.me();
        await accounts.updateProfile(user);
        _syncTheme(user.preferences.theme);
        me = user;
      } on ApiException catch (e) {
        // Offline: keep the account and show the sign-in screen's saved accounts.
        me = null;
        debugPrint('Could not load the profile: $e');
      }
    }
    loading = false;
    _connectRealtime();
    notifyListeners();
  }

  Future<void> reload() async {
    if (accounts.active == null) return;
    final user = await api.me();
    await accounts.updateProfile(user);
    me = user;
    notifyListeners();
  }

  void _syncTheme(String? theme) {
    if (theme != null && theme != themes.preference) themes.set(theme);
  }

  Future<void> _finishSignIn(AuthResult r) async {
    await accounts.signIn(r.user, Tokens(r.accessToken, r.refreshToken));
    queries.clear();
    _syncTheme(r.user.preferences.theme);
    addingAccount = false;
    me = r.user;
    _connectRealtime();
    notifyListeners();
  }

  Future<void> login(String login, String password, {String? code}) async =>
      _finishSignIn(await api.login(login, password, code: code));

  Future<void> register({
    required String username,
    required String email,
    required String password,
    required String displayName,
  }) async =>
      _finishSignIn(await api.register(username: username, email: email, password: password, displayName: displayName));

  void startAddAccount() {
    addingAccount = true;
    notifyListeners();
  }

  void cancelAddAccount() {
    addingAccount = false;
    notifyListeners();
  }

  Future<void> switchAccount(String id) async {
    if (id == accounts.active?.id && me != null) return;
    queries.clear();
    addingAccount = false;
    me = null;
    await accounts.setActive(id);
    await _loadMe();
  }

  Future<void> logout() async {
    final account = accounts.active;
    if (account?.tokens != null) await api.logout(account!.tokens!);
    if (account != null) await accounts.remove(account.id);
    queries.clear();
    me = null;
    await _loadMe();
  }

  void _signedOut() {
    me = null;
    queries.clear();
    _connectRealtime();
    notifyListeners();
  }

  Future<void> updatePreferences(Json patch) async {
    me = await api.updatePreferences(patch);
    await accounts.updateProfile(me!);
    notifyListeners();
  }

  Future<void> updateProfile({String? displayName, String? bio, String? avatarUrl}) async {
    me = await api.updateMe(
      displayName: displayName,
      bio: bio,
      avatarUrl: avatarUrl == null || avatarUrl.isEmpty ? null : avatarUrl,
      clearAvatar: avatarUrl != null && avatarUrl.isEmpty,
    );
    await accounts.updateProfile(me!);
    notifyListeners();
  }

  /// Apply a theme on this device and remember it for the account everywhere.
  Future<void> setTheme(String id, {Offset? origin}) async {
    themes.set(id, origin: origin);
    if (me != null) await updatePreferences({'theme': id});
  }

  // --- realtime -------------------------------------------------------------------------------

  void _connectRealtime() {
    _realtimeSub?.cancel();
    _realtime?.close();
    _realtime = null;
    if (me == null) return;
    final connection = RealtimeConnection(api);
    _realtime = connection;
    _realtimeSub = connection.events.listen(_onEvent);
  }

  void sendTyping(String chatId) => _realtime?.sendTyping(chatId);

  void _onEvent(RealtimeEvent e) {
    _events.add(e);
    switch (e.type) {
      case 'message.created' || 'message.updated':
        queries.invalidate('chats');
        queries.invalidate('support');
        if (e.message?.meta['applicationId'] != null) queries.invalidate('applications');
        final m = e.message;
        if (e.type == 'message.created' && m != null && m.sender?.id != me?.id && m.chatId != openChatId) {
          final chat = queries.peek<List<Chat>>('chats')?.where((c) => c.id == m.chatId).firstOrNull;
          _incoming.add(IncomingMessage(chat, m));
        }
      case 'chat.updated' || 'chat.removed':
        queries.invalidate('chats');
        queries.invalidate('support');
      case 'application.updated':
        queries.invalidate('applications');
        queries.invalidate('orgs');
        queries.invalidate('home');
        if (e.status == 'approved') reload().ignore();
      case 'story.created':
        queries.invalidate('stories');
      case 'wallet.updated':
        queries.invalidate('wallets');
        queries.invalidate('entries');
        queries.invalidate('orgs');
      case 'cash_request.updated':
        queries.invalidate('cashRequests');
      case 'invoice.updated':
        queries.invalidate('invoices');
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _realtime?.reconnect();
      queries.invalidate('chats');
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _realtimeSub?.cancel();
    _realtime?.close();
    _incoming.close();
    _events.close();
    super.dispose();
  }
}
