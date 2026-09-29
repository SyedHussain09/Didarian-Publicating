import { Link } from 'react-router-dom';
import { Page } from '../components/UI';

export default function About() {
  return (
    <Page
      title="Publish with Didarian"
      actions={
        <Link className="btn" to="/author/submissions/new">
          Submit Your Paper <span aria-hidden="true">↗</span>
        </Link>
      }
    >
      <div className="about-intro">
        <p className="eyebrow">Ideas across disciplines</p>
        <h2 className="font-serif text-3xl sm:text-4xl text-slate-900">
          Your research.
          <br />
          <em className="text-brand-700">A wider conversation.</em>
        </h2>
        <p className="text-slate-600 leading-relaxed max-w-xl">
          Didarian Publicating connects authors with an accessible submission, review, and
          publication process. Explore open access research or share work of your own.
        </p>
      </div>
      <div className="grid md:grid-cols-3 gap-4 mt-7">
        {[
          [
            '01',
            'Prepare your paper',
            'Sign in with Google, download a template from your author portal, and save a private manuscript draft.',
          ],
          [
            '02',
            'Submit for review',
            'Upload your manuscript and submit when you are ready. Follow its status and editorial feedback in your portal.',
          ],
          [
            '03',
            'Share your research',
            'Accepted papers appear in the public article library, where readers can explore and download the published work.',
          ],
        ].map(([number, title, description]) => (
          <section key={number} className="card process-card">
            <span className="eyebrow">{number} / The process</span>
            <h3 className="font-serif text-xl text-slate-900 mt-4 mb-2">{title}</h3>
            <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
          </section>
        ))}
      </div>
      <div className="publication-strip mt-6">
        <p>Already have a question about your submission?</p>
        <Link to="/contact" className="text-link text-sm">
          Contact the team <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </Page>
  );
}
