/** Desktop / browser notifications for new messages while the app is in the background. */

const KEY = 'ovl.notify';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function store(value: string): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* storage unavailable */
  }
}

export function notificationsEnabled(): boolean {
  return notificationsSupported() && Notification.permission === 'granted' && stored() !== 'off';
}

export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  const permission = await Notification.requestPermission();
  store(permission === 'granted' ? 'on' : 'off');
  return permission === 'granted';
}

export function disableNotifications(): void {
  store('off');
}

export function showNotification(title: string, body: string, tag: string, onClick: () => void): void {
  if (!notificationsEnabled() || !document.hidden) return;
  try {
    const notification = new Notification(title, { body, tag, icon: './icon-192.png' });
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  } catch {
    /* some webviews expose the API but refuse to construct notifications */
  }
}
