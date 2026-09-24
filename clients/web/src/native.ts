/**
 * Integration with the native shells:
 * - Android (Capacitor): the hardware back button navigates back or closes the app.
 * - Desktop (Tauri): external links open in the system browser instead of the app window.
 */

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: {
    App?: {
      addListener: (event: 'backButton', cb: (e: { canGoBack: boolean }) => void) => unknown;
      exitApp: () => void;
    };
  };
}

interface TauriGlobal {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

export function setupNativeShell(): void {
  const capacitor = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  const app = capacitor?.isNativePlatform?.() ? capacitor.Plugins?.App : undefined;
  app?.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) history.back();
    else app.exitApp();
  });

  const tauri = (window as { __TAURI_INTERNALS__?: TauriGlobal }).__TAURI_INTERNALS__;
  if (tauri) {
    document.addEventListener(
      'click',
      (event) => {
        const anchor = (event.target as Element | null)?.closest?.('a');
        const href = anchor?.getAttribute('href');
        if (!href || !/^(https?:|mailto:)/i.test(href)) return;
        if (href.startsWith('http') && new URL(href).origin === location.origin) return;
        event.preventDefault();
        void tauri.invoke('plugin:opener|open_url', { url: href });
      },
      true,
    );
  }
}
