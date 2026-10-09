import { describe, expect, it } from 'vitest';
import { isPublicAddress, resolvesToPublic } from './public-address.js';

describe('isPublicAddress', () => {
  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:4700::1111'])(
    'accepts %s, an address on the public internet',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '192.0.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
  ])('refuses %s, an IPv4 address inside the network or not routable', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:192.168.1.1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::1',
  ])('refuses %s, an IPv6 address inside the network, or one that reaches it', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it('accepts an IPv4-mapped public address and refuses what is not an address', () => {
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
    expect(isPublicAddress('example.com')).toBe(false);
    expect(isPublicAddress('')).toBe(false);
  });
});

describe('resolvesToPublic', () => {
  it('accepts a name that only has public addresses', async () => {
    expect(await resolvesToPublic('pics.example.com', async () => ['93.184.216.34'])).toBe(true);
  });

  it('refuses a name with any address inside the network', async () => {
    expect(await resolvesToPublic('x.example.com', async () => ['93.184.216.34', '10.0.0.1'])).toBe(
      false,
    );
    expect(await resolvesToPublic('127.0.0.1.nip.io', async () => ['127.0.0.1'])).toBe(false);
  });

  it('refuses a name that does not resolve, or resolves to nothing', async () => {
    expect(
      await resolvesToPublic('nope.example.com', async () => {
        throw new Error('ENOTFOUND');
      }),
    ).toBe(false);
    expect(await resolvesToPublic('empty.example.com', async () => [])).toBe(false);
  });

  it('judges a literal address without asking DNS', async () => {
    const never = async () => {
      throw new Error('should not be asked');
    };
    expect(await resolvesToPublic('127.0.0.1', never)).toBe(false);
    expect(await resolvesToPublic('[::1]', never)).toBe(false);
    expect(await resolvesToPublic('8.8.8.8', never)).toBe(true);
  });
});
