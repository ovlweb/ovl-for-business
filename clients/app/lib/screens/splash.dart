import 'package:flutter/material.dart';

import '../theme/theme.dart';
import '../ui/widgets.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Logo(size: 76, animated: true),
            const SizedBox(height: 26),
            SizedBox(
              width: 120,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(99),
                child: LinearProgressIndicator(
                  minHeight: 3,
                  color: context.c.accent,
                  backgroundColor: context.c.surface3,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
