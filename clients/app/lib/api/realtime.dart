import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'client.dart';
import 'models.dart';

enum RealtimeStatus { connecting, open, closed }

/// Auto-reconnecting WebSocket to /api/v1/realtime (messages, typing, applications,
/// stories and wallet updates). Refreshes the access token when the server closes with 4401.
class RealtimeConnection {
  RealtimeConnection(this.api) {
    _connect();
  }

  final OvlApi api;
  final ValueNotifier<RealtimeStatus> status = ValueNotifier(RealtimeStatus.connecting);
  final StreamController<RealtimeEvent> _events = StreamController.broadcast();
  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _sub;
  Timer? _retry;
  int _attempts = 0;
  bool _stopped = false;

  Stream<RealtimeEvent> get events => _events.stream;

  Future<void> _connect() async {
    if (_stopped) return;
    final tokens = api.tokens.tokens;
    if (tokens == null) {
      status.value = RealtimeStatus.closed;
      return;
    }
    status.value = RealtimeStatus.connecting;
    final http = api.uri('/realtime', {'token': tokens.accessToken});
    final url = http.replace(scheme: http.scheme == 'https' ? 'wss' : 'ws');
    try {
      final channel = WebSocketChannel.connect(url);
      _channel = channel;
      await channel.ready;
      if (_stopped) {
        await channel.sink.close();
        return;
      }
      _attempts = 0;
      status.value = RealtimeStatus.open;
      _sub = channel.stream.listen(
        (data) {
          try {
            _events.add(RealtimeEvent.fromJson(jsonDecode(data as String) as Json));
          } catch (_) {
            // Unknown event shapes are ignored.
          }
        },
        onDone: () => _closed(channel.closeCode),
        onError: (_) => _closed(null),
        cancelOnError: true,
      );
    } catch (_) {
      _closed(null);
    }
  }

  Future<void> _closed(int? code) async {
    _sub?.cancel();
    _sub = null;
    _channel = null;
    status.value = RealtimeStatus.closed;
    if (_stopped) return;
    if (code == 4401 && !await api.refresh()) return;
    final delay = Duration(milliseconds: min(30000, 1000 * pow(2, _attempts++).toInt()));
    _retry = Timer(delay, _connect);
  }

  /// Reconnect now (e.g. when the app returns to the foreground).
  void reconnect() {
    if (_stopped || status.value != RealtimeStatus.closed) return;
    _retry?.cancel();
    _attempts = 0;
    _connect();
  }

  void sendTyping(String chatId) {
    _channel?.sink.add(jsonEncode({'type': 'typing', 'chatId': chatId}));
  }

  void close() {
    _stopped = true;
    _retry?.cancel();
    _sub?.cancel();
    _channel?.sink.close();
    status.value = RealtimeStatus.closed;
    _events.close();
  }
}
