import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/query.dart';
import '../state/session.dart';
import '../theme/theme.dart';
import '../ui/format.dart';
import '../ui/widgets.dart';

Color _hex(String hex) => Color(int.parse('FF${hex.replaceFirst('#', '')}', radix: 16));

/// One bubble per author; staff (council, admin, owner) also get "New story".
class StoriesBar extends StatelessWidget {
  const StoriesBar({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final canPublish = session.can('stories.publish');
    return Query<List<Story>>(
      client: session.queries,
      queryKey: 'stories',
      fetch: session.api.stories,
      builder: (context, q) {
        final data = q.data ?? const <Story>[];
        final order = <String>[];
        for (final s in data) {
          if (!order.contains(s.author.id)) order.add(s.author.id);
        }
        final list = [for (final id in order) ...data.where((s) => s.author.id == id)];
        if (list.isEmpty && !canPublish) return const SizedBox.shrink();
        final authors = <(UserSummary, int, bool)>[];
        for (var i = 0; i < list.length; i++) {
          if (authors.isNotEmpty && authors.last.$1.id == list[i].author.id) {
            final last = authors.removeLast();
            authors.add((last.$1, last.$2, last.$3 && list[i].viewed));
          } else {
            authors.add((list[i].author, i, list[i].viewed));
          }
        }
        return SizedBox(
          height: 96,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              if (canPublish)
                _Bubble(
                  label: 'New story',
                  onTap: () => showPublishStory(context),
                  child: Container(
                    width: 58,
                    height: 58,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: context.c.borderStrong, width: 1.5),
                    ),
                    child: Icon(LucideIcons.plus, color: context.c.text2),
                  ),
                ),
              for (final (i, a) in authors.indexed)
                FadeSlideIn(
                  delay: stagger(i),
                  child: _Bubble(
                    label: a.$1.displayName.split(' ').first,
                    onTap: () => Navigator.of(context, rootNavigator: true).push(
                      PageRouteBuilder<void>(
                        opaque: false,
                        pageBuilder: (_, _, _) => StoryViewer(stories: list, start: a.$2),
                        transitionsBuilder: (_, a, _, child) => FadeTransition(
                          opacity: a,
                          child: ScaleTransition(scale: Tween(begin: 0.94, end: 1.0).animate(a), child: child),
                        ),
                      ),
                    ),
                    child: Container(
                      padding: const EdgeInsets.all(2.5),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: a.$3 ? null : context.ovl.gradient,
                        color: a.$3 ? context.c.border : null,
                      ),
                      child: Container(
                        padding: const EdgeInsets.all(2),
                        decoration: BoxDecoration(shape: BoxShape.circle, color: context.c.bg),
                        child: Avatar(name: a.$1.displayName, url: a.$1.avatarUrl, size: 50),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.label, required this.child, required this.onTap});

  final String label;
  final Widget child;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 14),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: SizedBox(
          width: 66,
          child: Column(
            children: [
              child,
              const SizedBox(height: 6),
              Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.text.labelMedium),
            ],
          ),
        ),
      ),
    );
  }
}

/// Full-screen story player: tap right / left to move, progress bars on top.
class StoryViewer extends StatefulWidget {
  const StoryViewer({super.key, required this.stories, required this.start});

  final List<Story> stories;
  final int start;

  @override
  State<StoryViewer> createState() => _StoryViewerState();
}

class _StoryViewerState extends State<StoryViewer> with SingleTickerProviderStateMixin {
  late int _i = widget.start;
  late final AnimationController _progress = AnimationController(vsync: this, duration: const Duration(seconds: 6))
    ..addStatusListener((s) {
      if (s == AnimationStatus.completed) _next();
    });

  @override
  void initState() {
    super.initState();
    _show();
  }

  void _show() {
    final story = widget.stories[_i];
    if (!story.viewed) {
      final session = context.read<Session>();
      session.api.viewStory(story.id).then((_) => session.queries.invalidate('stories')).ignore();
    }
    _progress.forward(from: 0);
  }

  void _next() {
    if (_i + 1 < widget.stories.length) {
      setState(() => _i++);
      _show();
    } else {
      Navigator.pop(context);
    }
  }

  void _prev() {
    if (_i > 0) setState(() => _i--);
    _show();
  }

  @override
  void dispose() {
    _progress.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final story = widget.stories[_i];
    final bg = _hex(story.background);
    return Scaffold(
      backgroundColor: Colors.black.withValues(alpha: 0.85),
      body: SafeArea(
        child: Center(
          child: AspectRatio(
            aspectRatio: 9 / 16,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: GestureDetector(
                onTapUp: (d) {
                  final box = context.size;
                  if (box != null && d.localPosition.dx < box.width / 3) {
                    _prev();
                  } else {
                    _next();
                  }
                },
                onLongPressStart: (_) => _progress.stop(),
                onLongPressEnd: (_) => _progress.forward(),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 350),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(26),
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [bg, Color.lerp(bg, Colors.black, 0.45)!],
                    ),
                  ),
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          for (var j = 0; j < widget.stories.length; j++)
                            Expanded(
                              child: Container(
                                height: 3,
                                margin: const EdgeInsets.symmetric(horizontal: 2),
                                decoration: BoxDecoration(
                                  color: Colors.white30,
                                  borderRadius: BorderRadius.circular(3),
                                ),
                                child: j < _i
                                    ? Container(color: Colors.white)
                                    : j == _i
                                    ? AnimatedBuilder(
                                        animation: _progress,
                                        builder: (_, _) => FractionallySizedBox(
                                          alignment: Alignment.centerLeft,
                                          widthFactor: _progress.value,
                                          child: Container(
                                            decoration: BoxDecoration(
                                              color: Colors.white,
                                              borderRadius: BorderRadius.circular(3),
                                            ),
                                          ),
                                        ),
                                      )
                                    : null,
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          Avatar(name: story.author.displayName, url: story.author.avatarUrl, size: 36),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Flexible(
                                      child: Text(
                                        story.author.displayName,
                                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Badges(story.author.badges),
                                  ],
                                ),
                                Text(
                                  timeAgo(story.createdAt),
                                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            onPressed: () => Navigator.pop(context),
                            icon: const Icon(LucideIcons.x, color: Colors.white),
                          ),
                        ],
                      ),
                      const Spacer(),
                      AnimatedSwitcher(
                        duration: const Duration(milliseconds: 300),
                        child: Text(
                          story.text,
                          key: ValueKey(story.id),
                          style: font(display, 28, FontWeight.w800, height: 1.2, color: Colors.white),
                        ),
                      ),
                      const Spacer(),
                      Row(
                        children: [
                          const Icon(LucideIcons.eye, size: 15, color: Colors.white70),
                          const SizedBox(width: 6),
                          Text(
                            plural(story.viewsCount, 'view'),
                            style: const TextStyle(color: Colors.white70, fontSize: 12.5),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

const _storyColors = ['#2563EB', '#7C3AED', '#047857', '#B45309', '#BE123C', '#0F172A'];

void showPublishStory(BuildContext context) {
  final text = TextEditingController();
  var color = _storyColors.first;
  var busy = false;
  Object? error;
  showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (sheet) => StatefulBuilder(
      builder: (sheet, set) => Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(sheet).bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('New service story', style: sheet.text.headlineSmall),
            const SizedBox(height: 4),
            Text('Visible to everyone for 24 hours.', style: sheet.text.bodyMedium),
            const SizedBox(height: 16),
            if (error != null) ...[ErrorBox(error), const SizedBox(height: 12)],
            AnimatedContainer(
              duration: const Duration(milliseconds: 250),
              height: 120,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: _hex(color), borderRadius: BorderRadius.circular(18)),
              child: TextField(
                controller: text,
                maxLines: null,
                maxLength: 500,
                style: font(display, 19, FontWeight.w800, color: Colors.white),
                decoration: const InputDecoration(
                  filled: false,
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  hintText: 'What should everyone know?',
                  hintStyle: TextStyle(color: Colors.white70),
                  counterStyle: TextStyle(color: Colors.white70),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                for (final hex in _storyColors)
                  GestureDetector(
                    onTap: () => set(() => color = hex),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      width: 34,
                      height: 34,
                      margin: const EdgeInsets.only(right: 10),
                      decoration: BoxDecoration(
                        color: _hex(hex),
                        shape: BoxShape.circle,
                        border: Border.all(color: hex == color ? sheet.c.text : Colors.transparent, width: 2.5),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 18),
            GradientButton(
              label: 'Publish',
              busy: busy,
              onPressed: () async {
                set(() => busy = true);
                final session = sheet.read<Session>();
                try {
                  await session.api.publishStory(text.text.trim(), color);
                  session.queries.invalidate('stories');
                  if (sheet.mounted) Navigator.pop(sheet);
                } catch (e) {
                  set(() {
                    busy = false;
                    error = e;
                  });
                }
              },
            ),
          ],
        ),
      ),
    ),
  );
}
