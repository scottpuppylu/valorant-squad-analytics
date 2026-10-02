import { describe, expect, it } from 'vitest';
import { primaryNavigation, secondaryNavigation } from '../src/i18n/zhTW';
import { publicRoutePaths } from '../src/routes';

describe('public analytical routes', () => {
  it('keeps every implemented analysis route available through hash-router paths', () => {
    expect(Object.values(publicRoutePaths)).toEqual(expect.arrayContaining([
      '/', '/leaderboard', '/compare', '/maps', '/agents', '/matches', '/connect', '/players/:playerId', '/dictionary', '/about', '/privacy',
    ]));
    expect([...primaryNavigation,...secondaryNavigation].map(({ to }) => to)).toEqual(expect.arrayContaining(['/leaderboard', '/compare', '/maps', '/agents', '/matches', '/connect']));
  });

  it('does not expose deferred product routes in primary navigation', () => {
    expect(primaryNavigation.some(({ to }) => to.includes('live-data'))).toBe(false);
    expect(primaryNavigation.some(({ to }) => to === '/synergy')).toBe(true);
  });
});
