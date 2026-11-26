import { redisKeySegment, scopedRedisKey } from './redis-key';

describe('redis-key helpers', () => {
  it('base64url-encodes dynamic segments', () => {
    expect(redisKeySegment('admin-1\r\nSET hacked 1')).toBe(
      'YWRtaW4tMQ0KU0VUIGhhY2tlZCAx',
    );
  });

  it('keeps only trusted literals as raw key prefixes', () => {
    expect(scopedRedisKey('admin:perms', 'admin-1')).toBe(
      'admin:perms:YWRtaW4tMQ',
    );
    expect(() => scopedRedisKey('admin perms', 'admin-1')).toThrow(
      /Invalid Redis key prefix/,
    );
  });
});
