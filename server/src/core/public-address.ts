import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** The addresses a host name resolves to. Injectable for tests. */
export type Resolve = (host: string) => Promise<string[]>;

const systemResolve: Resolve = async (host) =>
  (await lookup(host, { all: true })).map((record) => record.address);

function isPublicIpv4(octets: number[]): boolean {
  const [a = 0, b = 0, c = 0] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this host, private, loopback, multicast
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  return true;
}

/** The eight 16-bit groups of an IPv6 address, or undefined when it is not one. */
function ipv6Groups(address: string): number[] | undefined {
  let text = address.toLowerCase().split('%')[0] ?? '';
  const dotted = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [, a = 0, b = 0, c = 0, d = 0] = dotted.map(Number);
    text = text.replace(
      /\d+\.\d+\.\d+\.\d+$/,
      `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`,
    );
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const numbers = groups.map((group) => parseInt(group, 16));
  return numbers.length === 8 && numbers.every((n) => Number.isInteger(n)) ? numbers : undefined;
}

/** Whether an IP address is one on the public internet: not private, loopback, link-local, etc. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address.split('.').map(Number));
  if (version !== 6) return false;
  const g = ipv6Groups(address);
  if (!g) return false;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const v4 = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];
  if (g.every((group) => group === 0) || (g.slice(0, 7).every((n) => n === 0) && g7 === 1))
    return false; // :: and ::1
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0))
    return isPublicIpv4(v4); // IPv4-mapped and IPv4-compatible
  if (g0 === 0x64 && g1 === 0xff9b) return false; // NAT64: it reaches whatever the IPv4 side is
  if (g0 === 0x2002) return isPublicIpv4([g1 >> 8, g1 & 0xff, g2 >> 8, g2 & 0xff]); // 6to4
  if ((g0 & 0xfe00) === 0xfc00) return false; // unique local
  if ((g0 & 0xffc0) === 0xfe80) return false; // link-local
  if ((g0 & 0xff00) === 0xff00) return false; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // documentation
  return true;
}

/**
 * Whether a host name only leads to public addresses. A name that a feed author points at an
 * address inside the network (`127.0.0.1.nip.io`, a name in a private zone) fails here. It is
 * checked before connecting, so a name that changes its answer between the check and the request
 * is the part this cannot see.
 */
export async function resolvesToPublic(
  host: string,
  resolve: Resolve = systemResolve,
): Promise<boolean> {
  const name = host.replace(/^\[|\]$/g, '');
  if (isIP(name) !== 0) return isPublicAddress(name);
  try {
    const addresses = await resolve(name);
    return addresses.length > 0 && addresses.every(isPublicAddress);
  } catch {
    return false;
  }
}
