import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/client.dart';
import '../api/models.dart';

/// One signed-in account on this device.
class StoredAccount {
  StoredAccount({
    required this.id,
    required this.username,
    required this.displayName,
    required this.avatarUrl,
    required this.role,
    required this.badges,
    required this.addedAt,
    this.theme,
    this.tokens,
  });

  factory StoredAccount.fromJson(Json j) => StoredAccount(
    id: j['id'] as String,
    username: j['username'] as String,
    displayName: j['displayName'] as String,
    avatarUrl: j['avatarUrl'] as String?,
    role: j['role'] as String,
    badges: List<String>.from(j['badges'] as List? ?? const []),
    theme: j['theme'] as String?,
    addedAt: j['addedAt'] as int,
  );

  final String id;
  String username;
  String displayName;
  String? avatarUrl;
  String role;
  List<String> badges;
  String? theme;
  final int addedAt;
  Tokens? tokens;

  void updateFrom(Me me) {
    username = me.username;
    displayName = me.displayName;
    avatarUrl = me.avatarUrl;
    role = me.role;
    badges = me.badges;
    theme = me.preferences.theme;
  }

  Json toJson() => {
    'id': id,
    'username': username,
    'displayName': displayName,
    'avatarUrl': avatarUrl,
    'role': role,
    'badges': badges,
    'theme': theme,
    'addedAt': addedAt,
  };
}

/// Refresh tokens live in the platform keychain (Keychain, Keystore, Credential Manager,
/// libsecret). Where no keychain is available (e.g. a Linux box without a keyring) they
/// fall back to app storage so the app keeps working.
class _Vault {
  _Vault(this._prefs);

  final SharedPreferences _prefs;
  static const _secure = FlutterSecureStorage();
  bool _secureWorks = true;

  Future<T?> _try<T>(Future<T> Function() op) async {
    if (!_secureWorks) return null;
    try {
      return await op().timeout(const Duration(seconds: 3));
    } catch (e) {
      debugPrint('Secure storage unavailable, using app storage: $e');
      _secureWorks = false;
      return null;
    }
  }

  Future<String?> read(String key) async {
    final value = await _try(() => _secure.read(key: key));
    return value ?? _prefs.getString(key);
  }

  Future<void> write(String key, String? value) async {
    if (value == null) {
      await _try(() => _secure.delete(key: key));
      await _prefs.remove(key);
      return;
    }
    final ok = await _try(() async {
      await _secure.write(key: key, value: value);
      return true;
    });
    if (ok == true) {
      await _prefs.remove(key);
    } else {
      await _prefs.setString(key, value);
    }
  }
}

/// Several accounts per device, one of them active — the API client always uses the
/// active account's tokens.
class AccountStore extends ChangeNotifier implements TokenSink {
  AccountStore._(this._prefs) : _vault = _Vault(_prefs);

  static const _accountsKey = 'ovl.accounts';
  static const _activeKey = 'ovl.activeAccount';

  final SharedPreferences _prefs;
  final _Vault _vault;
  final List<StoredAccount> _accounts = [];
  String? _activeId;

  static Future<AccountStore> load(SharedPreferences prefs) async {
    final store = AccountStore._(prefs);
    final raw = prefs.getString(_accountsKey);
    if (raw != null) {
      for (final j in (jsonDecode(raw) as List).cast<Json>()) {
        final account = StoredAccount.fromJson(j);
        final tokens = await store._vault.read('ovl.tokens.${account.id}');
        if (tokens == null) continue;
        account.tokens = Tokens.fromJson(jsonDecode(tokens) as Json);
        store._accounts.add(account);
      }
    }
    store._activeId = prefs.getString(_activeKey);
    if (store.active == null) store._activeId = store._accounts.firstOrNull?.id;
    return store;
  }

  List<StoredAccount> get accounts => List.unmodifiable(_accounts..sort((a, b) => a.addedAt.compareTo(b.addedAt)));
  StoredAccount? get active => _accounts.where((a) => a.id == _activeId).firstOrNull;

  @override
  Tokens? get tokens => active?.tokens;

  @override
  Future<void> saveTokens(Tokens? tokens) async {
    final account = active;
    if (account == null) return;
    if (tokens == null) return remove(account.id);
    account.tokens = tokens;
    await _vault.write('ovl.tokens.${account.id}', jsonEncode(tokens.toJson()));
  }

  Future<void> _persist() async {
    await _prefs.setString(_accountsKey, jsonEncode(_accounts.map((a) => a.toJson()).toList()));
    if (_activeId == null) {
      await _prefs.remove(_activeKey);
    } else {
      await _prefs.setString(_activeKey, _activeId!);
    }
    notifyListeners();
  }

  /// Add (or refresh) an account after signing in and make it active.
  Future<void> signIn(Me me, Tokens tokens) async {
    var account = _accounts.where((a) => a.id == me.id).firstOrNull;
    if (account == null) {
      account = StoredAccount(
        id: me.id,
        username: me.username,
        displayName: me.displayName,
        avatarUrl: me.avatarUrl,
        role: me.role,
        badges: me.badges,
        addedAt: DateTime.now().millisecondsSinceEpoch,
      );
      _accounts.add(account);
    }
    account.updateFrom(me);
    account.tokens = tokens;
    _activeId = me.id;
    await _vault.write('ovl.tokens.${me.id}', jsonEncode(tokens.toJson()));
    await _persist();
  }

  Future<void> updateProfile(Me me) async {
    final account = _accounts.where((a) => a.id == me.id).firstOrNull;
    if (account == null) return;
    account.updateFrom(me);
    await _persist();
  }

  Future<void> setActive(String? id) async {
    _activeId = id;
    await _persist();
  }

  Future<void> remove(String id) async {
    _accounts.removeWhere((a) => a.id == id);
    await _vault.write('ovl.tokens.$id', null);
    if (_activeId == id) _activeId = _accounts.firstOrNull?.id;
    await _persist();
  }
}
