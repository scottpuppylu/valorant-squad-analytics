import { scoreMetricIds } from '../i18n/zhTW';
import { useDeferredValue, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { metricDefinitions } from '../data/metricDefinitions';
import type { MetricAvailability, MetricCategory, MetricDataSource, MetricType } from '../types/metrics';

const availabilityLabels: Record<MetricAvailability, string> = {
  IMPLEMENTED: '已實作',
  PROTOTYPE: '原型',
  RECONSTRUCTED: '已重建',
  PARTIAL: '部分證據',
  PLANNED: '規劃中',
  UNAVAILABLE: '目前不可用',
};

const typeLabels: Record<MetricType, string> = {
  RAW: '原始', DERIVED: '衍生', COMPOSITE: '綜合', CONTEXT: '脈絡', FUTURE: '未來',
};

const sourceLabels: Record<MetricDataSource, string> = {
  DEMO: '示範資料',
  RIOT_CONFIRMED: 'Riot 官方直接欄位',
  RIOT_REQUIRES_DERIVATION: 'Riot 官方欄位可推導',
  HENRIK_OBSERVED: 'HenrikDev 樣本曾觀察',
  DURABLE_RECONSTRUCTION: '持久化證據重建',
  NOT_CURRENTLY_AVAILABLE: '官方資料目前不足',
  FUTURE: '未來資料模型',
  UNKNOWN_REQUIRES_VERIFICATION: '需要進一步官方驗證',
};

const scoreIds = new Set<string>(Object.values(scoreMetricIds).filter((id) => id !== 'confidence'));

export function DictionaryPage() {
  const [params] = useSearchParams();
  const requestedMetric = params.get('metric');
  const [group, setGroup] = useState('全部');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<MetricCategory | 'ALL'>('ALL');
  const [availability, setAvailability] = useState<MetricAvailability | 'ALL'>('ALL');
  const [type, setType] = useState<MetricType | 'ALL'>('ALL');
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase('zh-TW'));

  const filtered = useMemo(() => metricDefinitions.filter((definition) => {
    const searchable = `${definition.abbreviation} ${definition.nameZhTW} ${definition.nameEnglish} ${definition.definition}`.toLocaleLowerCase('zh-TW');
    const matchesGroup = group === '全部' || (group === '八維評分' ? scoreIds.has(definition.id) : group === '搭檔分析' ? definition.id.includes('pair') || definition.id.includes('mutual') || ['duo-synergy','win-rate-lift'].includes(definition.id) : group === '樣本／信心' ? ['matches','rounds','confidence'].includes(definition.id) : group === '基礎數據' ? definition.type === 'RAW' || definition.type === 'DERIVED' && definition.dataSource !== 'DURABLE_RECONSTRUCTION' : definition.dataSource === 'DURABLE_RECONSTRUCTION' && definition.type !== 'COMPOSITE');
    return matchesGroup && (!deferredQuery || searchable.includes(deferredQuery))
      && (category === 'ALL' || definition.category === category)
      && (availability === 'ALL' || definition.currentAvailability === availability)
      && (type === 'ALL' || definition.type === type);
  }), [availability, category, deferredQuery, type, group]);

  return (
    <div>
      <header className="page-heading">
        <div>
          <p className="metric-label">透明指標註冊表</p>
          <h1>數據字典</h1>
          <p>查詢每項數據的公式、用途、來源與目前限制。原型與未實作項目會明確標示。</p>
        </div>
        <span className="data-pill inline-flex"><span /> {metricDefinitions.length} 項指標</span>
      </header>

      <div className="dictionary-groups" role="group" aria-label="指標群組">{['全部','基礎數據','進階證據','八維評分','搭檔分析','樣本／信心'].map((label) => <button className="button-secondary" key={label} type="button" aria-pressed={group === label} onClick={() => setGroup(label)}>{label}</button>)}</div>
      <section className="dictionary-controls mt-8" aria-label="數據字典篩選器">
        <label><span>搜尋</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：KAST、殘局、經濟" /></label>
        <label><span>類別</span><select value={category} onChange={(event) => setCategory(event.target.value as MetricCategory | 'ALL')}><option value="ALL">全部類別</option>{[...new Set(metricDefinitions.map((item) => item.category))].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>狀態</span><select value={availability} onChange={(event) => setAvailability(event.target.value as MetricAvailability | 'ALL')}><option value="ALL">全部狀態</option>{Object.entries(availabilityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>類型</span><select value={type} onChange={(event) => setType(event.target.value as MetricType | 'ALL')}><option value="ALL">全部類型</option>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      </section>

      <p className="mt-5 text-sm text-slate-400" role="status">顯示 {filtered.length} 項結果</p>
      <section className="mt-4 grid gap-3">
        {filtered.map((definition) => (
          <details className={`dictionary-item surface-card ${requestedMetric === definition.id ? 'dictionary-item--highlight' : ''}`} key={definition.id} open={requestedMetric === definition.id || undefined}>
            <summary>
              <span className="min-w-0"><strong>{definition.abbreviation}</strong><span>{definition.nameZhTW}<small>{definition.nameEnglish}</small></span></span>
              <span className="dictionary-tags"><em>{typeLabels[definition.type]}</em><em data-status={definition.currentAvailability}>{availabilityLabels[definition.currentAvailability]}</em></span>
            </summary>
            <div className="dictionary-detail">
              <div><h3>定義</h3><p>{definition.definition}</p></div>
              <div><h3>公式</h3><p className="font-mono text-xs">{definition.formula}</p></div>
              <div><h3>如何解讀</h3><p>{definition.interpretation}</p></div>
              <dl>
                <div><dt>單位</dt><dd>{definition.unit}</dd></div>
                <div><dt>資料來源</dt><dd>{sourceLabels[definition.dataSource]}</dd></div>
                <div><dt>使用維度</dt><dd>{definition.usedByDimensions.length ? definition.usedByDimensions.join('、') : '目前未使用'}</dd></div>
                <div><dt>所需輸入</dt><dd>{definition.requiredInputs.join('、')}</dd></div>
              </dl>
              <div><h3>限制</h3><ul>{definition.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></div>
              {definition.sampleWarning ? <p className="dictionary-warning">樣本提醒：{definition.sampleWarning}</p> : null}
              {definition.futureNotes ? <p className="dictionary-warning">後續：{definition.futureNotes}</p> : null}
            </div>
          </details>
        ))}
        {filtered.length === 0 ? <div className="surface-card p-8 text-center text-sm text-slate-400">找不到符合條件的指標，請調整搜尋或篩選條件。</div> : null}
      </section>
    </div>
  );
}
