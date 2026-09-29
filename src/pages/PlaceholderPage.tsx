import { Link } from 'react-router-dom';

interface PlaceholderPageProps {
  eyebrow: string;
  title: string;
  description: string;
  nextTask: string;
}

export function PlaceholderPage({ eyebrow, title, description, nextTask }: PlaceholderPageProps) {
  return (
    <div className="placeholder-page">
      <div className="surface-card p-7 sm:p-12">
        <p className="metric-label">{eyebrow}</p>
        <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-white sm:text-6xl">{title}</h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-slate-400">{description}</p>
        <div className="mt-8 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm font-medium text-slate-200">Planned for {nextTask}</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">The route is ready in TASK-001; deeper calculations and interactions stay in the existing roadmap.</p>
        </div>
        <Link className="button-primary mt-8 inline-flex" to="/">Return to dashboard</Link>
      </div>
    </div>
  );
}
