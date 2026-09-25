/** A human description of the device behind a session, parsed from its User-Agent. */
export interface DeviceInfo {
  /** "Chrome on Windows", "OVL Business app on Android", "API client". */
  name: string;
  /** Browser or app name, e.g. "Chrome", "OVL Business app". */
  client: string | null;
  /** Operating system, e.g. "macOS", "Android". */
  os: string | null;
  kind: 'desktop' | 'mobile' | 'tablet' | 'app' | 'api' | 'unknown';
}

const APP_PLATFORMS: Record<string, string> = {
  android: 'Android',
  ios: 'iOS',
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
  fuchsia: 'Fuchsia',
};

function osOf(ua: string): string | null {
  if (/iPad/.test(ua)) return 'iPadOS';
  if (/iPhone|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Linux|X11/.test(ua)) return 'Linux';
  return null;
}

function browserOf(ua: string): string | null {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
  return null;
}

export function describeUserAgent(userAgent: string | null | undefined): DeviceInfo {
  const ua = userAgent?.trim() ?? '';
  if (!ua) return { name: 'Unknown device', client: null, os: null, kind: 'unknown' };

  // The native apps send "OVLBusiness/<version> (<platform>)".
  const app = /^OVLBusiness\/[\w.+-]+(?: \(([^)]+)\))?/.exec(ua);
  if (app) {
    const platform = app[1]?.split(/[;\s]/)[0]?.toLowerCase() ?? '';
    const os = APP_PLATFORMS[platform] ?? null;
    return {
      name: os ? `OVL Business app on ${os}` : 'OVL Business app',
      client: 'OVL Business app',
      os,
      kind: 'app',
    };
  }
  if (/^(node|undici|Dart\/|curl\/|python-requests|axios|Go-http-client|okhttp|PostmanRuntime)/i.test(ua)) {
    return { name: 'API client', client: ua.split(/[\s/]/)[0] ?? null, os: null, kind: 'api' };
  }

  const os = osOf(ua);
  const client = browserOf(ua);
  const kind =
    /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))
      ? 'tablet'
      : /Mobile|iPhone|iPod/.test(ua)
        ? 'mobile'
        : client || os
          ? 'desktop'
          : 'unknown';
  const name = client && os ? `${client} on ${os}` : (client ?? os ?? 'Unknown device');
  return { name, client, os, kind };
}
