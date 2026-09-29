import { describe, expect, it } from 'vitest';
import { metricDefinitions, metricDefinitionById } from '../src/data/metricDefinitions';
import { BrowserAvatarRepository, MemoryAvatarRepository, PLAYER_EMOJI_STORAGE_KEY } from '../src/dataSources/avatars/BrowserAvatarRepository';
import { primaryNavigation, scoreMetricIds, zhTW } from '../src/i18n/zhTW';
import { categoryMetricWeights, overallWeights } from '../src/scoring/weights';
import { players } from '../src/data/players';
import { playerEmojiOptions } from '../src/types/avatar';
import { isPlayerEmoji, resolvePlayerEmoji } from '../src/utils/avatar';

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

  it('gives every player a valid default emoji', () => {
    expect(new Set(players.map(({ defaultEmoji }) => defaultEmoji)).size).toBe(players.length);
    expect(players.every(({ defaultEmoji }) => isPlayerEmoji(defaultEmoji))).toBe(true);
    expect(playerEmojiOptions.length).toBeGreaterThanOrEqual(11);
  });

  it('uses an override before the player default emoji', () => {
    expect(resolvePlayerEmoji(player, '👽')).toBe('👽');
    expect(resolvePlayerEmoji(player)).toBe(player.defaultEmoji);
  });

  it('persists and removes emoji overrides through the repository contract', async () => {
    const repository = new MemoryAvatarRepository();
    await repository.save(player.id, '🤖');
    expect((await repository.get(player.id))?.emoji).toBe('🤖');
    await repository.remove(player.id);
    expect(await repository.get(player.id)).toBeNull();
  });

  it('keeps overrides after a browser storage repository is recreated', async () => {
    const records = new Map<string, string>();
    const storage = {
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => { records.set(key, value); },
    };
    await new BrowserAvatarRepository(storage).save(player.id, '😎');
    expect((await new BrowserAvatarRepository(storage).get(player.id))?.emoji).toBe('😎');
  });

  it('falls back safely when browser storage is malformed', async () => {
    const records = new Map([[PLAYER_EMOJI_STORAGE_KEY, '{not valid json']]);
    const storage = {
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => { records.set(key, value); },
    };

    const repository = new BrowserAvatarRepository(storage);
    expect(await repository.get(player.id)).toBeNull();
    expect(resolvePlayerEmoji(player, (await repository.get(player.id))?.emoji)).toBe(player.defaultEmoji);
  });

  it('ignores invalid stored emoji records', async () => {
    const records = new Map([[PLAYER_EMOJI_STORAGE_KEY, JSON.stringify({
      version: 1,
      overrides: { [player.id]: { playerId: player.id, emoji: 'not-an-emoji', updatedAt: '2026-09-29T00:00:00.000Z' } },
    })]]);
    const storage = {
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => { records.set(key, value); },
    };

    expect(await new BrowserAvatarRepository(storage).get(player.id)).toBeNull();
  });
});

describe('zh-TW localization', () => {
  it('exposes Chinese primary navigation labels', () => {
    expect(primaryNavigation.map(({ label }) => label)).toEqual([
      zhTW.navigation.dashboard,
      zhTW.navigation.leaderboard,
      zhTW.navigation.players,
      zhTW.navigation.compare,
      zhTW.navigation.maps,
      zhTW.navigation.agents,
      zhTW.navigation.matches,
      zhTW.navigation.dictionary,
    ]);
    expect(primaryNavigation.every(({ label }) => /[\u3400-\u9fff]/u.test(label))).toBe(true);
  });
});
