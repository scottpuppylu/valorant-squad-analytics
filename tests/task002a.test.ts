import { describe, expect, it } from 'vitest';
import { metricDefinitions, metricDefinitionById } from '../src/data/metricDefinitions';
import { MemoryAvatarRepository } from '../src/dataSources/avatars/BrowserAvatarRepository';
import { primaryNavigation, scoreMetricIds, zhTW } from '../src/i18n/zhTW';
import { categoryMetricWeights, overallWeights } from '../src/scoring/weights';
import { players } from '../src/data/players';
import { maxAvatarFileBytes, resolveAvatarFallback, validateAvatarFile } from '../src/utils/avatar';

describe('metric dictionary', () => {
  it('uses unique stable IDs and complete required fields', () => {
    expect(metricDefinitions.length).toBeGreaterThanOrEqual(40);
    expect(new Set(metricDefinitions.map(({ id }) => id)).size).toBe(metricDefinitions.length);

    for (const definition of metricDefinitions) {
      expect(definition.id.trim()).not.toBe('');
      expect(definition.abbreviation.trim()).not.toBe('');
      expect(definition.nameZhTW.trim()).not.toBe('');
      expect(definition.nameEnglish.trim()).not.toBe('');
      expect(definition.definition.trim()).not.toBe('');
      expect(definition.formula.trim()).not.toBe('');
      expect(definition.interpretation.trim()).not.toBe('');
      expect(definition.limitations.length).toBeGreaterThan(0);
      expect(definition.requiredInputs.length).toBeGreaterThan(0);
    }
  });

  it('documents the formulas currently implemented by the scoring engine', () => {
    expect(metricDefinitionById.get('firepower')?.formula).toContain('35% ACS + 30% ADR + 20% KPR + 15% K/D');
    expect(metricDefinitionById.get('teamplay')?.formula).toContain('25% Win Rate');
    expect(metricDefinitionById.get('clutch-score')?.formula).toContain('75%');
    expect(metricDefinitionById.get('overall')?.formula).toContain(`${overallWeights.firepower * 100}% 火力`);
    expect(categoryMetricWeights.entry.map(({ metric }) => metric)).toEqual(['firstKillsPerRound', 'fkFd', 'kpr']);
  });

  it('clearly marks future concepts as not implemented', () => {
    for (const id of ['round-impact', 'economy', 'role-value', 'impact-kill', 'duo-synergy']) {
      const definition = metricDefinitionById.get(id);
      expect(definition?.type).toBe('FUTURE');
      expect(definition?.currentAvailability).toBe('PLANNED');
    }
  });

  it('has no broken score metric references', () => {
    for (const id of Object.values(scoreMetricIds)) {
      expect(metricDefinitionById.has(id), `missing metric definition: ${id}`).toBe(true);
    }
    for (const id of ['acs', 'adr', 'kd', 'kpr', 'apr', 'kast', 'fkpr', 'fk-fd', 'win-rate']) {
      expect(metricDefinitionById.has(id), `missing scoring input definition: ${id}`).toBe(true);
    }
  });
});

describe('avatar behavior', () => {
  const player = players[0]!;

  it('uses custom, configured default and initials fallbacks in order', () => {
    expect(resolveAvatarFallback(player, 'blob:custom')).toEqual({ kind: 'custom', source: 'blob:custom' });
    expect(resolveAvatarFallback({ ...player, defaultAvatarUrl: '/avatar.webp' })).toEqual({ kind: 'default', source: '/avatar.webp' });
    expect(resolveAvatarFallback(player)).toEqual({ kind: 'initials', source: 'NO' });
  });

  it('persists and removes avatar blobs through the repository contract', async () => {
    const repository = new MemoryAvatarRepository();
    const blob = new Blob(['avatar'], { type: 'image/webp' });
    await repository.save(player.id, blob);
    expect((await repository.get(player.id))?.blob.type).toBe('image/webp');
    await repository.remove(player.id);
    expect(await repository.get(player.id)).toBeNull();
  });

  it('rejects unsupported, empty and oversized avatar files', () => {
    expect(validateAvatarFile({ type: 'image/gif', size: 20 })).toContain('JPEG');
    expect(validateAvatarFile({ type: 'image/png', size: 0 })).toContain('空');
    expect(validateAvatarFile({ type: 'image/jpeg', size: maxAvatarFileBytes + 1 })).toContain('8 MB');
    expect(validateAvatarFile({ type: 'image/webp', size: 1024 })).toBeNull();
  });
});

describe('zh-TW localization', () => {
  it('exposes Chinese primary navigation labels', () => {
    expect(primaryNavigation.map(({ label }) => label)).toEqual([
      zhTW.navigation.dashboard,
      zhTW.navigation.leaderboard,
      zhTW.navigation.players,
      zhTW.navigation.dictionary,
      zhTW.navigation.matches,
    ]);
    expect(primaryNavigation.every(({ label }) => /[\u3400-\u9fff]/u.test(label))).toBe(true);
  });
});
