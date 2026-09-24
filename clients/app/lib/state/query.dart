import 'dart:async';

import 'package:flutter/widgets.dart';

/// A tiny query cache (in the spirit of react-query): screens share cached results by key,
/// show stale data instantly while refetching, and realtime events invalidate by prefix.
class QueryState<T> extends ChangeNotifier {
  QueryState(this.key);

  final String key;
  T? data;
  Object? error;
  bool fetching = false;
  DateTime? fetchedAt;
  Future<T> Function()? fetcher;
  int _watchers = 0;
  Future<T>? _inflight;

  bool get hasData => fetchedAt != null;

  Future<T> fetch() {
    final f = fetcher;
    if (f == null) return Future.error(StateError('No fetcher for $key'));
    return _inflight ??= () async {
      fetching = true;
      notifyListeners();
      try {
        final value = await f();
        data = value;
        error = null;
        fetchedAt = DateTime.now();
        return value;
      } catch (e) {
        error = e;
        rethrow;
      } finally {
        fetching = false;
        _inflight = null;
        notifyListeners();
      }
    }();
  }

  void changed() => notifyListeners();

  bool isStale(Duration staleTime) => fetchedAt == null || DateTime.now().difference(fetchedAt!) > staleTime;
}

class QueryClient {
  final Map<String, QueryState<dynamic>> _states = {};

  QueryState<T> state<T>(String key) => (_states[key] ??= QueryState<T>(key)) as QueryState<T>;

  T? peek<T>(String key) => _states[key]?.data as T?;

  /// Fetch through the cache (used by actions that need data outside a widget).
  Future<T> fetch<T>(String key, Future<T> Function() fetcher) {
    final s = state<T>(key)..fetcher = fetcher;
    return s.fetch();
  }

  void setData<T>(String key, T Function(T? current) update) {
    final s = state<T>(key);
    s.data = update(s.data);
    s.fetchedAt ??= DateTime.now();
    s.changed();
  }

  /// Mark every query whose key starts with [prefix] stale; refetch the ones on screen.
  void invalidate(String prefix) {
    for (final s in _states.values.where((s) => s.key.startsWith(prefix)).toList()) {
      s.fetchedAt = s.fetchedAt == null ? null : DateTime.fromMillisecondsSinceEpoch(0);
      if (s._watchers > 0 && s.fetcher != null) s.fetch().ignore();
    }
  }

  void clear() => _states.clear();
}

/// Fetches [queryKey] with [fetch] (cached, deduplicated) and rebuilds when it changes.
class Query<T> extends StatefulWidget {
  const Query({
    super.key,
    required this.client,
    required this.queryKey,
    required this.fetch,
    required this.builder,
    this.staleTime = const Duration(seconds: 15),
  });

  final QueryClient client;
  final String queryKey;
  final Future<T> Function() fetch;
  final Widget Function(BuildContext context, QueryState<T> state) builder;
  final Duration staleTime;

  @override
  State<Query<T>> createState() => _QueryState<T>();
}

class _QueryState<T> extends State<Query<T>> {
  late QueryState<T> _state;

  @override
  void initState() {
    super.initState();
    _attach();
  }

  void _attach() {
    _state = widget.client.state<T>(widget.queryKey)..fetcher = widget.fetch;
    _state._watchers++;
    _state.addListener(_changed);
    if (_state.isStale(widget.staleTime)) _state.fetch().ignore();
  }

  void _detach() {
    _state._watchers--;
    _state.removeListener(_changed);
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void didUpdateWidget(covariant Query<T> old) {
    super.didUpdateWidget(old);
    if (old.queryKey != widget.queryKey || old.client != widget.client) {
      _detach();
      _attach();
    } else {
      _state.fetcher = widget.fetch;
    }
  }

  @override
  void dispose() {
    _detach();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, _state);
}
