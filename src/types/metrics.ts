export type MetricType = 'RAW' | 'DERIVED' | 'COMPOSITE' | 'CONTEXT' | 'FUTURE';

export type MetricCategory =
  | '基礎數據'
  | '衍生數據'
  | '評分類別'
  | '進階分析'
  | '樣本資訊';

export type MetricAvailability = 'IMPLEMENTED' | 'PROTOTYPE' | 'PLANNED' | 'UNAVAILABLE';

export type MetricDataSource =
  | 'DEMO'
  | 'RIOT_CONFIRMED'
  | 'RIOT_REQUIRES_DERIVATION'
  | 'NOT_CURRENTLY_AVAILABLE'
  | 'FUTURE'
  | 'UNKNOWN_REQUIRES_VERIFICATION';

export interface MetricDefinition {
  id: string;
  abbreviation: string;
  nameZhTW: string;
  nameEnglish: string;
  category: MetricCategory;
  type: MetricType;
  unit: string;
  definition: string;
  formula: string;
  interpretation: string;
  higherIsGenerallyBetter: boolean | null;
  limitations: string[];
  requiredInputs: string[];
  currentAvailability: MetricAvailability;
  dataSource: MetricDataSource;
  usedByDimensions: string[];
  sampleWarning?: string;
  futureNotes?: string;
}
