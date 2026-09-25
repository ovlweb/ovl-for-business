import { BlockList, isIP } from 'node:net';

/**
 * "10.0.0.0/8, 203.0.113.7, 2001:db8::/32" → a matcher. An empty list allows everyone.
 * IPv4 addresses that arrive as IPv4-mapped IPv6 ("::ffff:10.1.2.3") match IPv4 entries.
 */
export function ipAllowlist(spec: string | undefined): ((ip: string) => boolean) | null {
  const entries = (spec ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  if (!entries.length) return null;
  const list = new BlockList();
  for (const entry of entries) {
    const [address, prefix] = entry.split('/');
    const family = isIP(address!);
    if (!family) throw new Error(`ADMIN_IP_ALLOWLIST: "${entry}" is not an IP address or network`);
    const type = family === 6 ? 'ipv6' : 'ipv4';
    if (prefix === undefined) list.addAddress(address!, type);
    else list.addSubnet(address!, Number(prefix), type);
  }
  return (ip: string) => {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
    const address = mapped ?? ip;
    const family = isIP(address);
    return family !== 0 && list.check(address, family === 6 ? 'ipv6' : 'ipv4');
  };
}
