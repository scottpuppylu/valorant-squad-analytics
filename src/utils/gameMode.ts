import type { GameMode } from '../types/valorant.js';

export function normalizeGameMode(queueId?: string | null, queueName?: string | null): GameMode {
  const label = queueName || queueId || 'Unknown';
  const normalized = label.toLowerCase();
  if (normalized.includes('competitive')) return 'Competitive';
  if (normalized.includes('premier')) return 'Premier';
  if (normalized.includes('unrated')) return 'Unrated';
  if (normalized.includes('custom')) return 'Custom';
  return label;
}
