import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:http/http.dart' as http;

import 'models.dart';

class Tokens {
  const Tokens(this.accessToken, this.refreshToken);

  factory Tokens.fromJson(Json j) => Tokens(j['accessToken'] as String, j['refreshToken'] as String);

  final String accessToken;
  final String refreshToken;

  Json toJson() => {'accessToken': accessToken, 'refreshToken': refreshToken};
}

/// Where the client reads and stores the active account's tokens.
abstract class TokenSink {
  Tokens? get tokens;
  Future<void> saveTokens(Tokens? tokens);
}

class ApiException implements Exception {
  ApiException(this.status, this.code, this.message);

  final int status;
  final String code;
  final String message;

  bool get isNetwork => status == 0;

  @override
  String toString() => message;
}

/// HTTP client for /api/v1 with transparent access-token refresh
/// (concurrent requests share one refresh, like the TypeScript SDK).
/// Identifies the native app in the account's device list ("OVL Business app on Android").
final String userAgent =
    'OVLBusiness/0.1.0 (${Platform.operatingSystem} ${Platform.operatingSystemVersion.split(' ').first})';

class OvlApi {
  OvlApi({required this.baseUrl, required this.tokens, this.onSignedOut});

  String baseUrl;
  final TokenSink tokens;
  final void Function()? onSignedOut;
  final http.Client _http = http.Client();
  Future<bool>? _refreshing;

  Uri uri(String path, [Map<String, Object?>? query]) {
    final q = <String, String>{
      for (final e in (query ?? const <String, Object?>{}).entries)
        if (e.value != null && e.value != '') e.key: '${e.value}',
    };
    final base = baseUrl.replaceAll(RegExp(r'/+$'), '');
    return Uri.parse('$base/api/v1$path').replace(queryParameters: q.isEmpty ? null : q);
  }

  Future<dynamic> request(
    String method,
    String path, {
    Object? body,
    Map<String, Object?>? query,
    bool retry = true,
  }) async {
    final current = tokens.tokens;
    final headers = <String, String>{
      'accept': 'application/json',
      'user-agent': userAgent,
      if (current != null) 'authorization': 'Bearer ${current.accessToken}',
      if (body != null) 'content-type': 'application/json',
    };
    final req = http.Request(method, uri(path, query))..headers.addAll(headers);
    if (body != null) req.body = jsonEncode(body);

    http.Response res;
    try {
      res = await http.Response.fromStream(await _http.send(req).timeout(const Duration(seconds: 20)));
    } on TimeoutException {
      throw ApiException(0, 'timeout', 'The server took too long to answer.');
    } catch (_) {
      throw ApiException(0, 'network', 'Cannot reach the server. Check your connection or the server address.');
    }

    if (res.statusCode == 401 && retry && current != null && !path.startsWith('/auth/')) {
      if (await refresh()) return request(method, path, body: body, query: query, retry: false);
    }
    if (res.statusCode == 204 || res.body.isEmpty) {
      if (res.statusCode >= 400) throw ApiException(res.statusCode, 'error', res.reasonPhrase ?? 'Request failed');
      return null;
    }
    final data = jsonDecode(utf8.decode(res.bodyBytes));
    if (res.statusCode >= 400) {
      final j = data is Map ? data : const {};
      throw ApiException(
        res.statusCode,
        (j['error'] ?? 'error') as String,
        (j['message'] ?? 'Request failed') as String,
      );
    }
    return data;
  }

  Future<bool> refresh() {
    return _refreshing ??= () async {
      final current = tokens.tokens;
      if (current == null) return false;
      try {
        final r = await request('POST', '/auth/refresh', body: {'refreshToken': current.refreshToken}, retry: false);
        await tokens.saveTokens(Tokens(r['accessToken'] as String, r['refreshToken'] as String));
        return true;
      } on ApiException catch (e) {
        if (e.isNetwork) return false;
        await tokens.saveTokens(null);
        onSignedOut?.call();
        return false;
      } finally {
        scheduleMicrotask(() => _refreshing = null);
      }
    }();
  }

  Future<Json> _get(String path, [Map<String, Object?>? query]) async =>
      await request('GET', path, query: query) as Json;
  Future<List<T>> _getList<T>(String path, T Function(Json) f, [Map<String, Object?>? query]) async =>
      ((await request('GET', path, query: query)) as List).map((e) => f(e as Json)).toList();
  Future<dynamic> _post(String path, [Object? body]) => request('POST', path, body: body ?? const {});
  Future<dynamic> _patch(String path, Object body) => request('PATCH', path, body: body);
  Future<dynamic> _delete(String path) => request('DELETE', path);

  /// Static platform metadata (currencies, roles, workflows, stock settings).
  Future<Json> meta() => _get('/meta');

  // --- auth & profile ---------------------------------------------------------------------

  /// Throws [ApiException] with code `two_factor_required` when the account needs a [code].
  Future<AuthResult> login(String login, String password, {String? code}) async =>
      AuthResult.fromJson(await _post('/auth/login', {'login': login, 'password': password, 'code': ?code}) as Json);

  Future<AuthResult> register({
    required String username,
    required String email,
    required String password,
    required String displayName,
  }) async => AuthResult.fromJson(
    await _post('/auth/register', {
      'username': username,
      'email': email,
      'password': password,
      'displayName': displayName,
    }) as Json,
  );

  Future<void> logout(Tokens tokens) async {
    try {
      await request('POST', '/auth/logout', body: {'refreshToken': tokens.refreshToken}, retry: false);
    } catch (_) {
      // Signing out locally is what matters.
    }
  }

  Future<Me> me() async => Me.fromJson(await _get('/me'));
  Future<Me> updateMe({String? displayName, String? bio, String? avatarUrl, bool clearAvatar = false}) async =>
      Me.fromJson(
        await _patch('/me', {
          'displayName': ?displayName,
          'bio': ?bio,
          if (avatarUrl != null || clearAvatar) 'avatarUrl': clearAvatar ? null : avatarUrl,
        }) as Json,
      );
  Future<Me> updatePreferences(Json patch) async => Me.fromJson(await _patch('/me/preferences', patch) as Json);
  Future<void> changePassword(String current, String next) =>
      _post('/me/password', {'currentPassword': current, 'newPassword': next});

  Future<TwoFactorStatus> twoFactorStatus() async => TwoFactorStatus.fromJson(await _get('/me/2fa'));
  Future<Json> twoFactorSetup() async => await _post('/me/2fa/setup') as Json;
  Future<List<String>> enableTwoFactor(String code) async =>
      List<String>.from(((await _post('/me/2fa/enable', {'code': code})) as Json)['recoveryCodes'] as List);
  Future<void> disableTwoFactor(String password, String code) =>
      _post('/me/2fa/disable', {'password': password, 'code': code});
  Future<List<String>> newRecoveryCodes(String code) async =>
      List<String>.from(((await _post('/me/2fa/recovery-codes', {'code': code})) as Json)['recoveryCodes'] as List);

  Future<List<SessionInfo>> sessions() => _getList('/me/sessions', SessionInfo.fromJson);
  Future<void> signOutSession(String id) => _delete('/me/sessions/$id');
  Future<int> signOutOtherSessions() async =>
      ((await _post('/me/sessions/sign-out-others')) as Json)['signedOut'] as int;

  // --- people -------------------------------------------------------------------------------

  Future<List<UserSummary>> searchUsers(String q) => _getList('/users/search', UserSummary.fromJson, {'q': q});
  Future<UserProfile> user(String username) async =>
      UserProfile.fromJson(await _get('/users/${Uri.encodeComponent(username)}'));
  Future<List<Contact>> contacts() => _getList('/contacts', Contact.fromJson);
  Future<void> addContact(String username) => _post('/contacts', {'username': username});
  Future<void> removeContact(String userId) => _delete('/contacts/$userId');

  // --- wallets -------------------------------------------------------------------------------

  Future<List<Wallet>> wallets() => _getList('/wallets', Wallet.fromJson);
  Future<Wallet> openWallet(String currency) async =>
      Wallet.fromJson(await _post('/wallets', {'currency': currency}) as Json);
  Future<Paged<LedgerEntry>> entries(String walletId, {int limit = 30, int offset = 0}) async => Paged.fromJson(
    await _get('/wallets/$walletId/entries', {'limit': limit, 'offset': offset}),
    LedgerEntry.fromJson,
  );
  Future<void> transfer({
    required String fromWalletId,
    required String username,
    required String amount,
    String? note,
  }) => _post('/wallets/transfer', {
    'fromWalletId': fromWalletId,
    'to': {'type': 'user', 'username': username},
    'amount': amount,
    if (note != null && note.isNotEmpty) 'note': note,
  });

  Future<List<CashRequest>> cashRequests(String walletId) =>
      _getList('/wallets/$walletId/cash-requests', CashRequest.fromJson);

  /// Ask a finance manager for a deposit or a payout (a payout holds the amount meanwhile).
  Future<CashRequest> requestCash(
    String walletId, {
    required String type,
    required String method,
    required String amount,
    String? note,
  }) async => CashRequest.fromJson(
    await _post('/wallets/$walletId/cash-requests', {
      'type': type,
      'method': method,
      'amount': amount,
      if (note != null && note.isNotEmpty) 'note': note,
    }) as Json,
  );
  Future<void> cancelCashRequest(String id) => _post('/cash-requests/$id/cancel');

  /// A 5-minute link to the CSV statement that needs no token, for the system browser.
  Future<Uri> statementLink(String walletId, {String? from, String? to}) async {
    final r = await _post('/wallets/$walletId/statement-link', {'from': ?from, 'to': ?to}) as Json;
    return Uri.parse('${baseUrl.replaceAll(RegExp(r'/+$'), '')}${r['path']}');
  }

  // --- invoices ------------------------------------------------------------------------

  Future<List<Invoice>> invoices({String? direction, String? status}) =>
      _getList('/invoices', Invoice.fromJson, {'direction': direction, 'status': status});
  Future<Invoice> invoice(String id) async => Invoice.fromJson(await _get('/invoices/$id'));

  /// [from] is null for a personal invoice, or a company id; [to] is `{'type': 'user', 'username': …}`
  /// or `{'type': 'organization', 'slug': …}`.
  Future<Invoice> createInvoice({
    String? from,
    required Json to,
    required String currency,
    required String dueDate,
    required List<Json> items,
    String? note,
  }) async => Invoice.fromJson(
    await _post('/invoices', {
      'from': from == null ? {'type': 'user'} : {'type': 'organization', 'organizationId': from},
      'to': to,
      'currency': currency,
      'dueDate': dueDate,
      'items': items,
      if (note != null && note.isNotEmpty) 'note': note,
    }) as Json,
  );
  Future<Invoice> payInvoice(String id, String walletId) async =>
      Invoice.fromJson(await _post('/invoices/$id/pay', {'walletId': walletId}) as Json);
  Future<Invoice> cancelInvoice(String id, {String? reason}) async => Invoice.fromJson(
    await _post('/invoices/$id/cancel', {if (reason != null && reason.isNotEmpty) 'reason': reason}) as Json,
  );

  // --- organizations ---------------------------------------------------------------------

  Future<List<Organization>> myOrganizations() => _getList('/organizations/mine', Organization.fromJson);
  Future<Organization> organization(String slug) async =>
      Organization.fromJson(await _get('/organizations/${Uri.encodeComponent(slug)}'));
  Future<List<Wallet>> organizationWallets(String id) => _getList('/organizations/$id/wallets', Wallet.fromJson);

  // --- applications ----------------------------------------------------------------------

  Future<List<Application>> myApplications() => _getList('/applications/mine', Application.fromJson);
  Future<List<Application>> reviewQueue() => _getList('/applications/queue', Application.fromJson);
  Future<Application> application(String id) async => Application.fromJson(await _get('/applications/$id'));
  Future<Application> submitApplication(String type, Json payload) async =>
      Application.fromJson(await _post('/applications', {'type': type, 'payload': payload}) as Json);
  Future<Application> review(String id, {required String decision, String? comment, List<String>? checklist}) async =>
      Application.fromJson(
        await _post('/applications/$id/review', {
          'decision': decision,
          if (comment != null && comment.isNotEmpty) 'comment': comment,
          'checklist': ?checklist,
        }) as Json,
      );
  Future<Application> withdraw(String id) async =>
      Application.fromJson(await _post('/applications/$id/withdraw') as Json);

  // --- registry --------------------------------------------------------------------------

  Future<Paged<RegistryEntry>> registry({String? q, String? kind, int limit = 30, int offset = 0}) async =>
      Paged.fromJson(
        await _get('/registry', {'q': q, 'kind': kind, 'limit': limit, 'offset': offset}),
        RegistryEntry.fromJson,
      );

  // --- stock exchange ------------------------------------------------------------------------

  Future<List<StockListing>> listings() => _getList('/stock/listings', StockListing.fromJson);
  Future<StockListing> listing(String ticker) async =>
      StockListing.fromJson(await _get('/stock/listings/${Uri.encodeComponent(ticker)}'));
  Future<Investment> invest(String ticker, String amount) async => Investment.fromJson(
    await _post('/stock/listings/${Uri.encodeComponent(ticker)}/invest', {'amount': amount}) as Json,
  );
  Future<Portfolio> portfolio() async => Portfolio.fromJson(await _get('/stock/portfolio'));

  // --- chats -----------------------------------------------------------------------------

  Future<List<Chat>> chats() => _getList('/chats', Chat.fromJson);
  Future<Chat> chat(String id) async => Chat.fromJson(await _get('/chats/$id'));
  Future<Chat> directChat(String userId) async =>
      Chat.fromJson(await _post('/chats/direct', {'userId': userId}) as Json);
  Future<Chat> createGroup(String title, List<String> memberIds) async =>
      Chat.fromJson(await _post('/chats/groups', {'title': title, 'memberIds': memberIds}) as Json);
  Future<List<ChatMember>> members(String chatId) => _getList('/chats/$chatId/members', ChatMember.fromJson);
  Future<List<Message>> messages(String chatId, {int? before, int limit = 50}) =>
      _getList('/chats/$chatId/messages', Message.fromJson, {'before': before, 'limit': limit});
  Future<Message> send(String chatId, String body, {int? replyToId}) async =>
      Message.fromJson(await _post('/chats/$chatId/messages', {'body': body, 'replyToId': ?replyToId}) as Json);
  Future<Message> editMessage(String chatId, int id, String body) async =>
      Message.fromJson(await _patch('/chats/$chatId/messages/$id', {'body': body}) as Json);
  Future<void> deleteMessage(String chatId, int id) => _delete('/chats/$chatId/messages/$id');
  Future<void> markRead(String chatId, int messageId) => _post('/chats/$chatId/read', {'messageId': messageId});
  Future<void> leave(String chatId, String myId) => _delete('/chats/$chatId/members/$myId');

  // --- support -----------------------------------------------------------------------------

  Future<List<Chat>> myTickets() => _getList('/support/tickets', Chat.fromJson);
  Future<List<Chat>> supportDesk(String status) => _getList('/support/desk', Chat.fromJson, {'status': status});
  Future<Chat> openTicket(String subject, String body) async =>
      Chat.fromJson(await _post('/support/tickets', {'subject': subject, 'body': body}) as Json);
  Future<void> setTicketStatus(String id, String status) => _post('/support/tickets/$id/status', {'status': status});

  // --- stories -------------------------------------------------------------------------------

  Future<List<Story>> stories() => _getList('/stories', Story.fromJson);
  Future<void> viewStory(String id) => _post('/stories/$id/view');
  Future<void> publishStory(String text, String background) =>
      _post('/stories', {'text': text, 'background': background, 'durationHours': 24});
}
