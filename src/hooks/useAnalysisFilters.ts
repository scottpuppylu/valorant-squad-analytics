import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { defaultAnalysisFilters } from '../analytics/filters';
import type { AnalysisFilters } from '../analytics/types';

function positiveNumber(value: string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function filtersFromParams(params: URLSearchParams): AnalysisFilters {
  return {
    playerId: params.get('player') || 'all',
    period: (['all', 'recent10', 'recent30', 'custom'].includes(params.get('period') ?? '') ? params.get('period') : 'all') as AnalysisFilters['period'],
    dateFrom: params.get('from') || undefined,
    dateTo: params.get('to') || undefined,
    map: (params.get('map') || 'all') as AnalysisFilters['map'],
    agent: (params.get('agent') || 'all') as AnalysisFilters['agent'],
    role: (params.get('role') || 'all') as AnalysisFilters['role'],
    gameMode: (params.get('mode') || 'all') as AnalysisFilters['gameMode'],
    minMatches: positiveNumber(params.get('minMatches')),
    minRounds: positiveNumber(params.get('minRounds')),
  };
}

export function useAnalysisFilters() {
  const [params, setParams] = useSearchParams();
  const paramsRef = useRef(params);
  useEffect(() => { paramsRef.current = params; }, [params]);
  const filters = useMemo<AnalysisFilters>(() => filtersFromParams(params), [params]);

  function update(patch: Partial<AnalysisFilters>) {
    const nextParams = new URLSearchParams(paramsRef.current);
    nextParams.delete('page');
    const values: Array<[keyof AnalysisFilters, string, string | number | undefined, string | number]> = [
      ['playerId', 'player', patch.playerId, defaultAnalysisFilters.playerId],
      ['period', 'period', patch.period, defaultAnalysisFilters.period],
      ['dateFrom', 'from', patch.dateFrom, ''],
      ['dateTo', 'to', patch.dateTo, ''],
      ['map', 'map', patch.map, defaultAnalysisFilters.map],
      ['agent', 'agent', patch.agent, defaultAnalysisFilters.agent],
      ['role', 'role', patch.role, defaultAnalysisFilters.role],
      ['gameMode', 'mode', patch.gameMode, defaultAnalysisFilters.gameMode],
      ['minMatches', 'minMatches', patch.minMatches, 0],
      ['minRounds', 'minRounds', patch.minRounds, 0],
    ];
    for (const [field, key, value, defaultValue] of values) {
      if (!(field in patch)) continue;
      if (value === undefined || value === '' || value === defaultValue) nextParams.delete(key);
      else nextParams.set(key, String(value));
    }
    if ('period' in patch && patch.period !== 'custom') {
      nextParams.delete('from');
      nextParams.delete('to');
    }
    paramsRef.current = nextParams;
    setParams(nextParams, { replace: true });
  }

  function reset() {
    const preserved = new URLSearchParams();
    for (const key of ['metric', 'direction', 'players', 'view']) {
      const value = params.get(key);
      if (value) preserved.set(key, value);
    }
    paramsRef.current = preserved;
    setParams(preserved, { replace: true });
  }

  return { filters, update, reset, params, setParams };
}
