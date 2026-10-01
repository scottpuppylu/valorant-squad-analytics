import { useContext } from 'react';
import { DatasetContext } from '../contexts/DatasetContext';

export function useDataset() {
  const value = useContext(DatasetContext);
  if (!value) throw new Error('useDataset 必須在 DatasetProvider 內使用。');
  return value;
}
