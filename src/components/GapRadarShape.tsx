interface Point { x: number; y: number; value?: unknown }
interface Props { points?: readonly Point[]; stroke?: string; fill?: string; fillOpacity?: number; strokeDasharray?: string }
// Recharts' default Radar maps null to radius zero. Draw only observed points and adjacent observed edges.
export function GapRadarShape({points=[],stroke,fill,fillOpacity,strokeDasharray}: Props) {
  const valid=(point:Point) => typeof point.value === 'number' && Number.isFinite(point.value);
  const all=points.length>0 && points.every(valid);
  return <g aria-hidden="true">
    {all ? <polygon points={points.map((p)=>p.x+','+p.y).join(' ')} stroke={stroke} fill={fill} fillOpacity={fillOpacity} strokeDasharray={strokeDasharray} /> :
      points.map((point,index) => {const next=points[(index+1)%points.length]!;return valid(point)&&valid(next) ? <line key={index} x1={point.x} y1={point.y} x2={next.x} y2={next.y} stroke={stroke} strokeDasharray={strokeDasharray} /> : null;})}
    {points.filter(valid).map((point,index)=><circle key={index} cx={point.x} cy={point.y} r={3} fill={stroke} />)}
  </g>;
}
