import { Link } from 'react-router-dom';
import { getMetricDefinition } from '../data/metricDefinitions';

interface MetricInfoProps {
  metricId: string;
  label?: string;
  className?: string;
  linked?: boolean;
}

export function MetricInfo({ metricId, label, className = '', linked = true }: MetricInfoProps) {
  const definition = getMetricDefinition(metricId);
  if (!definition) return <span className={className}>{label ?? metricId}</span>;
  if (!linked) {
    return <span className={`metric-info ${className}`.trim()} title={`${definition.nameZhTW}：${definition.definition}`}><span>{label ?? definition.abbreviation}</span><span aria-hidden="true">ⓘ</span></span>;
  }
  return (
    <span className={`metric-info ${className}`.trim()}>
      <span>{label ?? definition.abbreviation}</span>
      <Link
        to={`/dictionary?metric=${definition.id}`}
        aria-label={`查看${definition.nameZhTW}定義`}
        title={`${definition.nameZhTW}：${definition.definition}`}
      >ⓘ</Link>
    </span>
  );
}
