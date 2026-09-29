import { Page } from '../components/UI';

const board = [
  ['JS', 'Dr. Jane Smith', 'Editor-in-Chief'],
  ['AL', 'Prof. Alan Lee', 'Associate Editor'],
  ['MK', 'Dr. Maria Garcia', 'Board Member'],
  ['DW', 'Dr. David Wu', 'Board Member'],
];
export default function Editorial() {
  return (
    <Page title="Editorial Board">
      <p className="text-sm text-slate-500 mb-6 max-w-2xl leading-relaxed">
        The names below are supplied website content. Editorial appointments are awaiting
        confirmation by Didarian Publicating.
      </p>
      <div className="grid md:grid-cols-2 gap-4">
        {board.map(([initials, name, role]) => (
          <div className="card editor-card" key={name}>
            <div className="editor-avatar" aria-hidden="true">
              {initials}
            </div>
            <div>
              <p className="eyebrow mb-2">{role}</p>
              <h2 className="font-serif font-bold text-slate-900 text-lg">{name}</h2>
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}
