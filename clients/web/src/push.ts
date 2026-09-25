/** Web Push on this browser: subscribe with the server's VAPID key and register the device. */
import { api } from './api';
import { t } from '@ovl/ui';

const KEY = 'ovl.push.device';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function read(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function write(value: Record<string, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

/** The device id this browser registered for an account, if any. */
export function pushDeviceId(userId: string): string | null {
  return read()[userId] ?? null;
}

function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64url}${'='.repeat((4 - (base64url.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function browserLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

export async function enablePush(userId: string): Promise<void> {
  if (!pushSupported()) throw new Error(t('This browser cannot receive push notifications'));
  if ((await Notification.requestPermission()) !== 'granted')
    throw new Error(t('Allow notifications for this site in your browser first'));
  const { webPushKey } = await api.notifications.pushConfig();
  if (!webPushKey) throw new Error(t('This server does not send push notifications'));
  await navigator.serviceWorker.register('./sw.js');
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(webPushKey),
    }));
  const json = subscription.toJSON();
  const device = await api.notifications.addDevice({
    kind: 'webpush',
    endpoint: json.endpoint!,
    keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! },
    label: browserLabel(),
  });
  // A browser subscription belongs to one account: the one that turned pushes on last.
  write({ [userId]: device.id });
}

export async function disablePush(userId: string): Promise<void> {
  const id = pushDeviceId(userId);
  write({});
  if (id) await api.notifications.removeDevice(id).catch(() => undefined);
  const registration = await navigator.serviceWorker?.getRegistration();
  await (await registration?.pushManager.getSubscription())?.unsubscribe();
}
