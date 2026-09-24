import 'dart:async';
import 'dart:math';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/query.dart';
import '../state/session.dart';
import '../theme/theme.dart';
import '../ui/format.dart';
import '../ui/widgets.dart';

String chatSubtitle(Chat chat) => switch (chat.type) {
  'direct' => chat.peer == null ? '' : '@${chat.peer!.username}',
  'group' => 'Group · ${plural(chat.memberCount, 'member')}',
  'channel' => 'News channel · @${chat.handle} · ${plural(chat.memberCount, 'subscriber')}',
  'council' => 'Council · ${plural(chat.memberCount, 'member')}',
  'moderation' => 'Moderation team · ${plural(chat.memberCount, 'member')}',
  'support' => chat.support == null ? 'Tech support' : 'Tech support · ${chat.support!.requester.displayName}',
  _ => '',
};

IconData? chatTypeIcon(String type) => switch (type) {
  'channel' => LucideIcons.radio,
  'council' => LucideIcons.landmark,
  'moderation' => LucideIcons.shield,
  'support' => LucideIcons.lifeBuoy,
  'group' => LucideIcons.users,
  _ => null,
};

class ChatAvatar extends StatelessWidget {
  const ChatAvatar(this.chat, {super.key, this.size = 46});

  final Chat chat;
  final double size;

  @override
  Widget build(BuildContext context) {
    if (chat.type == 'council' || chat.type == 'moderation') {
      return IconTile(chatTypeIcon(chat.type)!, size: size, gradient: context.ovl.gradient);
    }
    return Avatar(name: chat.peer?.displayName ?? chat.title, url: chat.peer?.avatarUrl, size: size);
  }
}

class ChatTile extends StatelessWidget {
  const ChatTile({super.key, required this.chat, required this.onTap, this.selected = false});

  final Chat chat;
  final VoidCallback onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final m = chat.lastMessage;
    final preview = m == null
        ? 'No messages yet'
        : m.deleted
        ? 'Message deleted'
        : chat.type != 'direct' && m.sender != null && !m.isSystem
        ? '${m.sender!.displayName.split(' ').first}: ${m.body}'
        : m.body;
    final icon = chatTypeIcon(chat.type);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      child: Material(
        color: selected ? c.accentSoft : Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
            child: Row(
              children: [
                ChatAvatar(chat),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          if (icon != null && chat.type != 'council' && chat.type != 'moderation') ...[
                            Icon(icon, size: 14, color: c.text3),
                            const SizedBox(width: 5),
                          ],
                          if (chat.pinned) ...[
                            Icon(LucideIcons.pin, size: 13, color: c.text3),
                            const SizedBox(width: 4),
                          ],
                          Expanded(
                            child: Text(
                              chat.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: context.text.titleMedium,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            listTime(chat.activityAt),
                            style: context.text.bodySmall?.copyWith(color: chat.unreadCount > 0 ? c.accent : c.text3),
                          ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              preview,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: context.text.bodyMedium?.copyWith(fontSize: 13.5),
                            ),
                          ),
                          if (chat.unreadCount > 0)
                            AnimatedScale(
                              scale: 1,
                              duration: const Duration(milliseconds: 200),
                              child: Container(
                                margin: const EdgeInsets.only(left: 8),
                                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                decoration: BoxDecoration(color: c.accent, borderRadius: BorderRadius.circular(99)),
                                child: Text(
                                  '${chat.unreadCount}',
                                  style: font(body, 11.5, FontWeight.w800, color: c.accentText),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Chat list (+ split view on wide screens)
// ---------------------------------------------------------------------------

class ChatsScreen extends StatelessWidget {
  const ChatsScreen({super.key, this.selectedId});

  final String? selectedId;

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 900;
    final list = ChatList(selectedId: selectedId);
    if (!wide) {
      return selectedId == null
          ? Scaffold(body: SafeArea(bottom: false, child: list))
          : ConversationView(key: ValueKey(selectedId), chatId: selectedId!, backTo: '/chats');
    }
    return Scaffold(
      body: SafeArea(
        child: Row(
          children: [
            SizedBox(width: 360, child: list),
            VerticalDivider(width: 1, color: context.c.border),
            Expanded(
              child: selectedId == null
                  ? const EmptyState(
                      icon: LucideIcons.messagesSquare,
                      title: 'Select a chat',
                      text: 'Direct messages, groups, news channels and staff rooms live here.',
                    )
                  : ConversationView(key: ValueKey(selectedId), chatId: selectedId!, embedded: true),
            ),
          ],
        ),
      ),
    );
  }
}

class ChatList extends StatefulWidget {
  const ChatList({super.key, this.selectedId});

  final String? selectedId;

  @override
  State<ChatList> createState() => _ChatListState();
}

class _ChatListState extends State<ChatList> {
  final _filter = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(18, 16, 12, 8),
          child: Row(
            children: [
              Expanded(child: Text('Chats', style: context.text.headlineMedium)),
              FilledButton.icon(
                onPressed: () => showNewChatSheet(context),
                icon: const Icon(LucideIcons.plus, size: 17),
                label: const Text('New'),
                style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 4, 14, 8),
          child: TextField(
            controller: _filter,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(hintText: 'Filter chats', prefixIcon: Icon(LucideIcons.search, size: 17)),
          ),
        ),
        Expanded(
          child: Query<List<Chat>>(
            client: session.queries,
            queryKey: 'chats',
            fetch: session.api.chats,
            builder: (context, s) {
              if (!s.hasData) {
                return s.error != null
                    ? Padding(
                        padding: const EdgeInsets.all(16),
                        child: ErrorBox(s.error, onRetry: () => s.fetch()),
                      )
                    : const SkeletonList(rows: 7);
              }
              final needle = _filter.text.trim().toLowerCase();
              final chats = s.data!.where((c) => needle.isEmpty || c.title.toLowerCase().contains(needle)).toList()
                ..sort((a, b) => a.pinned != b.pinned ? (a.pinned ? -1 : 1) : b.activityAt.compareTo(a.activityAt));
              if (chats.isEmpty) {
                return const EmptyState(
                  icon: LucideIcons.messageCircle,
                  title: 'No chats yet',
                  text: 'Start one from your contacts.',
                );
              }
              return RefreshIndicator(
                onRefresh: () => s.fetch(),
                child: ListView.builder(
                  padding: const EdgeInsets.only(bottom: 20),
                  itemCount: chats.length,
                  itemBuilder: (context, i) => FadeSlideIn(
                    delay: stagger(i, 25),
                    child: ChatTile(
                      chat: chats[i],
                      selected: chats[i].id == widget.selectedId,
                      onTap: () => context.go('/chats/${chats[i].id}'),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

class ConversationView extends StatefulWidget {
  const ConversationView({
    super.key,
    required this.chatId,
    this.embedded = false,
    this.backTo,
    this.composerHint,
    this.headerActions,
  });

  final String chatId;
  final bool embedded;
  final String? backTo;
  final String? composerHint;
  final List<Widget> Function(Chat chat, VoidCallback refresh)? headerActions;

  @override
  State<ConversationView> createState() => _ConversationViewState();
}

class _ConversationViewState extends State<ConversationView> {
  late final Session _session = context.read<Session>();
  final List<Message> _messages = []; // newest first
  final _composer = TextEditingController();
  final _focus = FocusNode();
  final _scroll = ScrollController();
  StreamSubscription<dynamic>? _sub;
  Chat? _chat;
  Object? _error;
  bool _loading = true;
  bool _loadingOlder = false;
  bool _hasOlder = true;
  Message? _replyTo;
  Message? _editing;
  bool _sending = false;
  Timer? _typingClear;
  DateTime _lastTypingSent = DateTime(0);
  String? _typingName;

  @override
  void initState() {
    super.initState();
    _session.openChatId = widget.chatId;
    _load();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 300) _loadOlder();
    });
    _sub = _session.events.listen((e) {
      if (e.chatId != widget.chatId) return;
      if ((e.type == 'message.created' || e.type == 'message.updated') && e.message != null) {
        setState(() {
          final i = _messages.indexWhere((m) => m.id == e.message!.id);
          if (i >= 0) {
            _messages[i] = e.message!;
          } else {
            _messages.insert(0, e.message!);
            if (e.message!.sender?.id != null && e.message!.sender!.id == _typingSenderId) _typingName = null;
          }
        });
        _markRead();
      } else if (e.type == 'typing' && e.userId != _session.me?.id) {
        _typingSenderId = e.userId;
        setState(() => _typingName = 'Someone');
        _typingClear?.cancel();
        _typingClear = Timer(const Duration(seconds: 4), () => mounted ? setState(() => _typingName = null) : null);
      } else if (e.type == 'chat.updated') {
        _refreshChat();
      } else if (e.type == 'chat.removed') {
        if (mounted) context.go(widget.backTo ?? '/chats');
      }
    });
  }

  String? _typingSenderId;

  Future<void> _refreshChat() async {
    try {
      final chat = await _session.api.chat(widget.chatId);
      if (mounted) setState(() => _chat = chat);
    } catch (_) {}
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([_session.api.chat(widget.chatId), _session.api.messages(widget.chatId)]);
      if (!mounted) return;
      setState(() {
        _chat = results[0] as Chat;
        _messages
          ..clear()
          ..addAll(results[1] as List<Message>);
        _hasOlder = _messages.length == 50;
        _loading = false;
      });
      _markRead();
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  Future<void> _loadOlder() async {
    if (_loadingOlder || !_hasOlder || _messages.isEmpty) return;
    _loadingOlder = true;
    try {
      final older = await _session.api.messages(widget.chatId, before: _messages.last.id);
      if (!mounted) return;
      setState(() {
        _messages.addAll(older);
        _hasOlder = older.length == 50;
      });
    } finally {
      _loadingOlder = false;
    }
  }

  void _markRead() {
    final newest = _messages.firstOrNull;
    if (newest == null || _chat?.myRole == null) return;
    _session.api.markRead(widget.chatId, newest.id).then((_) => _session.queries.invalidate('chats')).ignore();
  }

  Future<void> _send() async {
    final text = _composer.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      if (_editing != null) {
        final updated = await _session.api.editMessage(widget.chatId, _editing!.id, text);
        setState(() {
          final i = _messages.indexWhere((m) => m.id == updated.id);
          if (i >= 0) _messages[i] = updated;
          _editing = null;
        });
      } else {
        final sent = await _session.api.send(widget.chatId, text, replyToId: _replyTo?.id);
        setState(() {
          if (!_messages.any((m) => m.id == sent.id)) _messages.insert(0, sent);
          _replyTo = null;
        });
        _session.queries.invalidate('chats');
      }
      _composer.clear();
      if (_scroll.hasClients) _scroll.animateTo(0, duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
      _focus.requestFocus();
    }
  }

  void _typing() {
    if (DateTime.now().difference(_lastTypingSent) > const Duration(milliseconds: 2500)) {
      _lastTypingSent = DateTime.now();
      _session.sendTyping(widget.chatId);
    }
  }

  Future<void> _actions(Message m, Offset? at) async {
    final me = _session.me!;
    final mine = m.sender?.id == me.id;
    final canModerate = _chat?.myRole == 'owner' || _chat?.myRole == 'admin' || me.can('support.answer');
    final choice = await showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      builder: (sheet) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_chat?.canPost ?? false)
              ListTile(
                leading: const Icon(LucideIcons.reply, size: 19),
                title: const Text('Reply'),
                onTap: () => Navigator.pop(sheet, 'reply'),
              ),
            ListTile(
              leading: const Icon(LucideIcons.copy, size: 19),
              title: const Text('Copy text'),
              onTap: () => Navigator.pop(sheet, 'copy'),
            ),
            if (mine)
              ListTile(
                leading: const Icon(LucideIcons.pencil, size: 19),
                title: const Text('Edit'),
                onTap: () => Navigator.pop(sheet, 'edit'),
              ),
            if (mine || canModerate)
              ListTile(
                leading: Icon(LucideIcons.trash2, size: 19, color: sheet.c.danger),
                title: Text('Delete', style: TextStyle(color: sheet.c.danger)),
                onTap: () => Navigator.pop(sheet, 'delete'),
              ),
          ],
        ),
      ),
    );
    if (!mounted) return;
    switch (choice) {
      case 'reply':
        setState(() {
          _replyTo = m;
          _editing = null;
        });
        _focus.requestFocus();
      case 'copy':
        await Clipboard.setData(ClipboardData(text: m.body));
        if (mounted) toast(context, 'Copied');
      case 'edit':
        setState(() {
          _editing = m;
          _replyTo = null;
          _composer.text = m.body;
        });
        _focus.requestFocus();
      case 'delete':
        try {
          await _session.api.deleteMessage(widget.chatId, m.id);
        } catch (e) {
          if (mounted) toast(context, errorText(e), error: true);
        }
    }
  }

  @override
  void dispose() {
    if (_session.openChatId == widget.chatId) _session.openChatId = null;
    _sub?.cancel();
    _typingClear?.cancel();
    _composer.dispose();
    _focus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final chat = _chat;
    final me = _session.me!;
    final byId = {for (final m in _messages) m.id: m};

    final header = Container(
      padding: EdgeInsets.fromLTRB(widget.embedded ? 18 : 4, 8, 8, 8),
      decoration: BoxDecoration(
        color: c.surface,
        border: Border(bottom: BorderSide(color: c.border)),
      ),
      child: Row(
        children: [
          if (!widget.embedded)
            IconButton(
              tooltip: 'Back',
              onPressed: () => context.go(widget.backTo ?? '/chats'),
              icon: const Icon(LucideIcons.arrowLeft),
            ),
          if (chat != null) ...[
            Hero(tag: 'chat-${chat.id}', child: ChatAvatar(chat, size: 40)),
            const SizedBox(width: 12),
            Expanded(
              child: InkWell(
                onTap: chat.peer != null ? () => context.push('/u/${chat.peer!.username}') : null,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(chat.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.text.titleMedium),
                    AnimatedSwitcher(
                      duration: const Duration(milliseconds: 200),
                      child: Text(
                        _typingName != null ? 'typing…' : chatSubtitle(chat),
                        key: ValueKey(_typingName),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.text.bodySmall?.copyWith(color: _typingName != null ? c.accent : null),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            ...?widget.headerActions?.call(chat, _refreshChat),
            IconButton(
              tooltip: 'Chat details',
              onPressed: () => showChatInfo(context, chat),
              icon: const Icon(LucideIcons.info, size: 20),
            ),
          ] else
            const Expanded(child: SizedBox(height: 40)),
        ],
      ),
    );

    Widget body;
    if (_loading) {
      body = const Center(child: CircularProgressIndicator());
    } else if (_error != null) {
      body = Padding(
        padding: const EdgeInsets.all(16),
        child: ErrorBox(_error, onRetry: _load),
      );
    } else if (_messages.isEmpty) {
      body = EmptyState(
        icon: LucideIcons.messageCircle,
        title: 'Say hello',
        text: chat?.type == 'support' ? 'Our team answers here.' : 'No messages here yet.',
      );
    } else {
      body = LayoutBuilder(
        builder: (context, box) => ListView.builder(
          controller: _scroll,
          reverse: true,
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          itemCount: _messages.length,
          itemBuilder: (context, i) {
            final m = _messages[i];
            final older = i + 1 < _messages.length ? _messages[i + 1] : null;
            final newer = i > 0 ? _messages[i - 1] : null;
            final newDay = older == null || dayLabel(older.createdAt) != dayLabel(m.createdAt);
            final grouped =
                older != null &&
                !newDay &&
                older.sender?.id == m.sender?.id &&
                !older.isSystem &&
                m.createdAt.difference(older.createdAt).inMinutes < 5;
            final lastOfGroup =
                newer == null ||
                newer.sender?.id != m.sender?.id ||
                newer.isSystem ||
                newer.createdAt.difference(m.createdAt).inMinutes >= 5;
            return Column(
              children: [
                if (newDay) _DaySeparator(dayLabel(m.createdAt)),
                MessageBubble(
                  message: m,
                  mine: m.sender?.id == me.id,
                  showSender: !grouped && chat != null && chat.type != 'direct',
                  showAvatar: lastOfGroup,
                  replyTo: m.replyToId == null ? null : byId[m.replyToId],
                  onActions: (at) => _actions(m, at),
                  staff: me.isStaff,
                  maxWidth: min(box.maxWidth * 0.78, 560),
                ),
              ],
            );
          },
        ),
      );
    }

    final composer = chat == null
        ? const SizedBox.shrink()
        : !chat.canPost
        ? Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: c.surface,
              border: Border(top: BorderSide(color: c.border)),
            ),
            child: Text(
              'Only channel admins can post here.',
              textAlign: TextAlign.center,
              style: context.text.bodySmall,
            ),
          )
        : _Composer(
            controller: _composer,
            focus: _focus,
            sending: _sending,
            hint: widget.composerHint ?? 'Write a message…',
            replyTo: _replyTo,
            editing: _editing,
            onCancel: () => setState(() {
              _replyTo = null;
              if (_editing != null) _composer.clear();
              _editing = null;
            }),
            onSend: _send,
            onTyping: _typing,
          );

    final content = Column(
      children: [
        header,
        Expanded(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [c.bg, Color.lerp(c.bg, c.accentSoft, 0.35)!],
              ),
            ),
            child: body,
          ),
        ),
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 200),
          child: _typingName == null
              ? const SizedBox.shrink()
              : Container(
                  width: double.infinity,
                  padding: const EdgeInsets.fromLTRB(18, 4, 18, 4),
                  child: Text('Someone is typing…', style: context.text.bodySmall?.copyWith(color: c.accent)),
                ),
        ),
        composer,
      ],
    );
    return widget.embedded ? content : Scaffold(body: SafeArea(child: content));
  }
}

class _DaySeparator extends StatelessWidget {
  const _DaySeparator(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(
            color: context.c.surface,
            borderRadius: BorderRadius.circular(99),
            border: Border.all(color: context.c.border),
          ),
          child: Text(label, style: context.text.labelMedium),
        ),
      ),
    );
  }
}

class MessageBubble extends StatelessWidget {
  const MessageBubble({
    super.key,
    required this.message,
    required this.mine,
    required this.showSender,
    required this.showAvatar,
    required this.onActions,
    required this.staff,
    this.replyTo,
    this.maxWidth = 520,
  });

  final Message message;
  final bool mine;
  final bool showSender;
  final bool showAvatar;
  final Message? replyTo;
  final void Function(Offset? at) onActions;
  final bool staff;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final m = message;
    if (m.isSystem && m.meta['applicationId'] == null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Center(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
            decoration: BoxDecoration(color: c.surface2, borderRadius: BorderRadius.circular(99)),
            child: Text(m.body, textAlign: TextAlign.center, style: context.text.bodySmall),
          ),
        ),
      );
    }
    if (m.meta['applicationId'] != null) return _ApplicationCard(message: m, staff: staff);

    final textColor = mine ? Colors.white : c.text;
    final bubble = Container(
      constraints: BoxConstraints(maxWidth: maxWidth),
      padding: const EdgeInsets.fromLTRB(13, 9, 13, 7),
      decoration: BoxDecoration(
        gradient: mine && !m.deleted ? context.ovl.gradient : null,
        color: mine ? (m.deleted ? c.surface3 : null) : c.surface,
        border: mine ? null : Border.all(color: c.border),
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(18),
          topRight: const Radius.circular(18),
          bottomLeft: Radius.circular(mine || !showAvatar ? 18 : 5),
          bottomRight: Radius.circular(!mine || !showAvatar ? 18 : 5),
        ),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6, offset: const Offset(0, 2))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (showSender && !mine && m.sender != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(
                    child: Text(
                      m.sender!.displayName,
                      overflow: TextOverflow.ellipsis,
                      style: font(
                        body,
                        12.5,
                        FontWeight.w700,
                        color: context.ovl.role(m.sender!.role == 'user' ? 'moderator' : m.sender!.role),
                      ),
                    ),
                  ),
                  if (m.sender!.badges.isNotEmpty) ...[const SizedBox(width: 6), Badges(m.sender!.badges)],
                ],
              ),
            ),
          if (replyTo != null)
            Container(
              margin: const EdgeInsets.only(bottom: 6),
              padding: const EdgeInsets.fromLTRB(8, 5, 8, 5),
              decoration: BoxDecoration(
                color: mine ? Colors.white.withValues(alpha: 0.16) : c.surface2,
                borderRadius: BorderRadius.circular(8),
                border: Border(left: BorderSide(color: mine ? Colors.white : c.accent, width: 3)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    replyTo!.sender?.displayName ?? 'System',
                    style: font(body, 12, FontWeight.w700, color: mine ? Colors.white : c.accent),
                  ),
                  Text(
                    replyTo!.deleted ? 'Message deleted' : replyTo!.body,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12.5, color: textColor.withValues(alpha: 0.8)),
                  ),
                ],
              ),
            ),
          Text(
            m.deleted ? 'Message deleted' : m.body,
            style: TextStyle(
              fontSize: 14.5,
              height: 1.4,
              color: m.deleted ? c.text3 : textColor,
              fontStyle: m.deleted ? FontStyle.italic : null,
            ),
          ),
          const SizedBox(height: 2),
          Align(
            alignment: Alignment.bottomRight,
            child: Text(
              '${m.editedAt != null && !m.deleted ? 'edited · ' : ''}${shortTime(m.createdAt)}',
              style: TextStyle(fontSize: 10.5, color: mine && !m.deleted ? Colors.white70 : c.text3),
            ),
          ),
        ],
      ),
    );

    return Padding(
      padding: EdgeInsets.only(top: showSender ? 8 : 2, bottom: 2),
      child: Row(
        mainAxisAlignment: mine ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!mine) ...[
            SizedBox(
              width: 32,
              child: showAvatar && m.sender != null
                  ? Avatar(name: m.sender!.displayName, url: m.sender!.avatarUrl, size: 30)
                  : null,
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: GestureDetector(
              onLongPress: m.deleted ? null : () => onActions(null),
              onSecondaryTapUp: m.deleted ? null : (d) => onActions(d.globalPosition),
              child: TweenAnimationBuilder<double>(
                tween: Tween(begin: 0.9, end: 1),
                duration: const Duration(milliseconds: 260),
                curve: Curves.easeOutBack,
                builder: (_, v, child) => Transform.scale(
                  scale: v,
                  alignment: mine ? Alignment.bottomRight : Alignment.bottomLeft,
                  child: child,
                ),
                child: bubble,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Application updates posted into staff rooms, with a shortcut to the review queue.
class _ApplicationCard extends StatelessWidget {
  const _ApplicationCard({required this.message, required this.staff});

  final Message message;
  final bool staff;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: OvlCard(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(LucideIcons.fileText, size: 16, color: c.accent),
                    const SizedBox(width: 6),
                    Caption('Application update', color: c.accent),
                    const Spacer(),
                    Text(shortTime(message.createdAt), style: context.text.bodySmall),
                  ],
                ),
                const SizedBox(height: 8),
                Text(message.body, style: context.text.bodyLarge?.copyWith(fontSize: 14)),
                if (staff) ...[
                  const SizedBox(height: 8),
                  TextButton.icon(
                    onPressed: () => context.go('/review/${message.meta['applicationId']}'),
                    icon: const Icon(LucideIcons.arrowRight, size: 16),
                    label: const Text('Open in review queue'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.focus,
    required this.sending,
    required this.hint,
    required this.replyTo,
    required this.editing,
    required this.onCancel,
    required this.onSend,
    required this.onTyping,
  });

  final TextEditingController controller;
  final FocusNode focus;
  final bool sending;
  final String hint;
  final Message? replyTo;
  final Message? editing;
  final VoidCallback onCancel;
  final VoidCallback onSend;
  final VoidCallback onTyping;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final context0 = replyTo ?? editing;
    return Container(
      decoration: BoxDecoration(
        color: c.surface,
        border: Border(top: BorderSide(color: c.border)),
      ),
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedSize(
              duration: const Duration(milliseconds: 200),
              child: context0 == null
                  ? const SizedBox(width: double.infinity)
                  : Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.fromLTRB(12, 6, 4, 6),
                      decoration: BoxDecoration(
                        color: c.accentSoft,
                        borderRadius: BorderRadius.circular(12),
                        border: Border(left: BorderSide(color: c.accent, width: 3)),
                      ),
                      child: Row(
                        children: [
                          Icon(editing != null ? LucideIcons.pencil : LucideIcons.reply, size: 16, color: c.accent),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  editing != null ? 'Edit message' : 'Reply to ${replyTo!.sender?.displayName ?? ''}',
                                  style: font(body, 12.5, FontWeight.w700, color: c.accent),
                                ),
                                Text(
                                  context0.body,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: context.text.bodySmall,
                                ),
                              ],
                            ),
                          ),
                          IconButton(onPressed: onCancel, icon: const Icon(LucideIcons.x, size: 16)),
                        ],
                      ),
                    ),
            ),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: CallbackShortcuts(
                    bindings: {const SingleActivator(LogicalKeyboardKey.enter): onSend},
                    child: TextField(
                      controller: controller,
                      focusNode: focus,
                      minLines: 1,
                      maxLines: 5,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => onSend(),
                      onChanged: (_) => onTyping(),
                      decoration: InputDecoration(
                        hintText: hint,
                        fillColor: c.surface2,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(22),
                          borderSide: BorderSide.none,
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(22),
                          borderSide: BorderSide.none,
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(22),
                          borderSide: BorderSide(color: c.accent),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                ValueListenableBuilder(
                  valueListenable: controller,
                  builder: (context, v, _) {
                    final ready = v.text.trim().isNotEmpty && !sending;
                    return AnimatedScale(
                      scale: ready ? 1 : 0.9,
                      duration: const Duration(milliseconds: 180),
                      child: Container(
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: ready ? context.ovl.gradient : null,
                          color: ready ? null : c.surface3,
                        ),
                        child: IconButton(
                          tooltip: 'Send',
                          onPressed: ready ? onSend : null,
                          icon: Icon(
                            editing != null ? LucideIcons.check : LucideIcons.send,
                            size: 19,
                            color: ready ? Colors.white : c.text3,
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Chat details, new chats
// ---------------------------------------------------------------------------

void showChatInfo(BuildContext context, Chat chat) {
  final session = context.read<Session>();
  showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (sheet) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
      maxChildSize: 0.92,
      builder: (sheet, scroll) => FutureBuilder<List<ChatMember>>(
        future: chat.type == 'direct' ? Future.value(const []) : session.api.members(chat.id),
        builder: (sheet, snap) => ListView(
          controller: scroll,
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          children: [
            Center(child: ChatAvatar(chat, size: 72)),
            const SizedBox(height: 12),
            Text(chat.title, textAlign: TextAlign.center, style: sheet.text.headlineSmall),
            Text(chatSubtitle(chat), textAlign: TextAlign.center, style: sheet.text.bodyMedium),
            if (chat.description.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(chat.description, textAlign: TextAlign.center, style: sheet.text.bodyMedium),
            ],
            const SizedBox(height: 18),
            if (snap.hasData && snap.data!.isNotEmpty) ...[
              Caption('Members'),
              const SizedBox(height: 6),
              for (final m in snap.data!)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Avatar(name: m.user.displayName, url: m.user.avatarUrl, size: 36),
                  title: NameWithBadges(m.user),
                  subtitle: Text('@${m.user.username}'),
                  trailing: m.role == 'member' ? null : Text(humanize(m.role), style: sheet.text.labelMedium),
                  onTap: () {
                    Navigator.pop(sheet);
                    GoRouter.of(context).push('/u/${m.user.username}');
                  },
                ),
            ] else if (chat.type != 'direct')
              const SkeletonList(rows: 3),
            if (chat.type == 'group') ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(foregroundColor: sheet.c.danger),
                onPressed: () async {
                  await session.api.leave(chat.id, session.me!.id);
                  session.queries.invalidate('chats');
                  if (sheet.mounted) Navigator.pop(sheet);
                  if (context.mounted) context.go('/chats');
                },
                icon: const Icon(LucideIcons.logOut, size: 17),
                label: const Text('Leave group'),
              ),
            ],
          ],
        ),
      ),
    ),
  );
}

void showNewChatSheet(BuildContext context) {
  final session = context.read<Session>();
  final title = TextEditingController();
  final picked = <String>{};
  var group = false;
  var busy = false;
  Object? error;
  final contactsFuture = session.queries.fetch('contacts', session.api.contacts);
  showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (sheet) => StatefulBuilder(
      builder: (sheet, set) => Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(sheet).bottom),
        child: FutureBuilder<List<Contact>>(
          future: contactsFuture,
          builder: (sheet, snap) {
            final contacts = snap.data ?? const <Contact>[];
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Segmented<bool>(
                  value: group,
                  options: const [(false, 'Direct message'), (true, 'New group')],
                  onChanged: (v) => set(() => group = v),
                ),
                const SizedBox(height: 14),
                if (error != null) ...[ErrorBox(error), const SizedBox(height: 10)],
                if (group) ...[
                  LabeledField(label: 'Group name', controller: title, icon: LucideIcons.users),
                  const SizedBox(height: 8),
                  Text('Groups can only include people from your contacts.', style: sheet.text.bodySmall),
                  const SizedBox(height: 8),
                ],
                if (!snap.hasData)
                  const SkeletonList(rows: 3)
                else if (contacts.isEmpty)
                  EmptyState(
                    icon: LucideIcons.users,
                    title: 'No contacts yet',
                    text: 'Add people in Contacts first.',
                    action: FilledButton(
                      onPressed: () {
                        Navigator.pop(sheet);
                        context.go('/contacts');
                      },
                      child: const Text('Open contacts'),
                    ),
                  )
                else
                  ConstrainedBox(
                    constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(sheet).height * 0.45),
                    child: ListView(
                      shrinkWrap: true,
                      children: [
                        for (final u in contacts)
                          ListTile(
                            contentPadding: EdgeInsets.zero,
                            leading: Avatar(name: u.displayName, url: u.avatarUrl, size: 38),
                            title: NameWithBadges(u),
                            subtitle: Text('@${u.username}'),
                            trailing: group
                                ? Checkbox(
                                    value: picked.contains(u.id),
                                    onChanged: (_) =>
                                        set(() => picked.contains(u.id) ? picked.remove(u.id) : picked.add(u.id)),
                                  )
                                : const Icon(LucideIcons.messageCircle, size: 18),
                            onTap: () async {
                              if (group) {
                                set(() => picked.contains(u.id) ? picked.remove(u.id) : picked.add(u.id));
                                return;
                              }
                              final chat = await session.api.directChat(u.id);
                              session.queries.invalidate('chats');
                              if (sheet.mounted) Navigator.pop(sheet);
                              if (context.mounted) context.go('/chats/${chat.id}');
                            },
                          ),
                      ],
                    ),
                  ),
                if (group) ...[
                  const SizedBox(height: 12),
                  GradientButton(
                    label: 'Create group',
                    busy: busy,
                    onPressed: title.text.trim().isEmpty && picked.isEmpty
                        ? null
                        : () async {
                            set(() => busy = true);
                            try {
                              final chat = await session.api.createGroup(title.text.trim(), picked.toList());
                              session.queries.invalidate('chats');
                              if (sheet.mounted) Navigator.pop(sheet);
                              if (context.mounted) context.go('/chats/${chat.id}');
                            } catch (e) {
                              set(() {
                                busy = false;
                                error = e;
                              });
                            }
                          },
                  ),
                ],
              ],
            );
          },
        ),
      ),
    ),
  );
}

/// Keeps pointer scroll working for desktop mice inside nested lists.
class DesktopScrollBehavior extends MaterialScrollBehavior {
  const DesktopScrollBehavior();

  @override
  Set<PointerDeviceKind> get dragDevices => {...super.dragDevices, PointerDeviceKind.mouse, PointerDeviceKind.trackpad};
}
