import { Link } from 'react-router-dom';
import { Page } from '../components/UI';

export default function Privacy() {
  return (
    <Page title="Privacy Policy" narrow>
      <div className="text-sm text-slate-600 leading-relaxed space-y-4">
        <p>
          GGC Research Publishing is committed to protecting your privacy. This policy describes the
          information used by this publication platform.
        </p>
        <details className="policy-section" name="privacy-topic" open>
          <summary>1. Information Collection</summary>
          <p>
            We collect information you voluntarily provide, including your name, email, academic
            affiliation, manuscript files, submission metadata, and contact messages. When you sign
            in with Google, we receive your name and email to create your account. Your Google
            password is not shared with this application. Admin Author profiles include a name and
            institution. Reviewer profiles include a unique public username. Co-author contact
            information is supplied by the submitting author, who should have permission to provide
            it.
          </p>
        </details>
        <details className="policy-section" name="privacy-topic">
          <summary>2. Use of Information</summary>
          <p>
            Information is used to manage accounts, process submissions and editorial decisions,
            publish accepted manuscripts, and respond to contact messages. A submitted manuscript
            and its author details are available to authorized administrators. Drafts are private to
            their owner.
          </p>
        </details>
        <details className="policy-section" name="privacy-topic">
          <summary>3. Publication</summary>
          <p>
            On acceptance, the selected manuscript file, title, abstract, publication author names,
            category, keywords, and publication date become publicly available. Account email
            addresses, internal notes, rejected manuscripts, and previous manuscript versions are
            not published. Author and co-author institutions are public with their names. Co-author
            email addresses remain private. Reviewer comments and usernames are public; reviewers
            can edit or delete their own comments. Likes are counted publicly. Saved reading lists
            are private; an author may receive an unnamed notification that a paper was saved.
          </p>
        </details>
        <details className="policy-section" name="privacy-topic">
          <summary>4. Sessions and Service Providers</summary>
          <p>
            This application uses Google for sign-in, Supabase for authentication sessions, database
            records and file storage, and Netlify for website hosting. Authentication uses browser
            storage to keep you signed in. Contact requests may use short-lived, hashed network
            identifiers to limit abuse. Article activity and editorial decisions generate website
            notifications only. Admins may remove comments or remove and restore articles.
            Moderation records retain the administrator’s decision and reason.
          </p>
        </details>
        <details className="policy-section" name="privacy-topic">
          <summary>5. Privacy Requests</summary>
          <p>
            Use the{' '}
            <Link to="/contact" className="text-link">
              contact form
            </Link>{' '}
            for questions about your information. Organization contact details, retention periods,
            and any region-specific privacy disclosures require the publisher's confirmation before
            public launch.
          </p>
        </details>
      </div>
    </Page>
  );
}
