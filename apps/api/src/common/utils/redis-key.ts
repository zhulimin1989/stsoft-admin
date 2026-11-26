const REDIS_KEY_PREFIX_RE = /^[A-Za-z0-9:_-]+$/;

export function redisKeySegment(value: string | number): string {
  return Buffer.from(String(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function scopedRedisKey(
  prefix: string,
  ...segments: Array<string | number>
): string {
  if (!REDIS_KEY_PREFIX_RE.test(prefix)) {
    throw new Error(`Invalid Redis key prefix: ${prefix}`);
  }
  return [prefix, ...segments.map(redisKeySegment)].join(':');
}
