export type Status = 'draft' | 'submitted' | 'under_review' | 'published' | 'rejected';
export interface Submission {
  id: string;
  owner_id: string;
  title: string;
  abstract: string;
  author_names: string;
  category: string;
  keywords: string[];
  publication_consent: boolean;
  status: Status;
  current_file_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  article_slug?: string | null;
  submitter?: { first_name: string; last_name: string; affiliation: string };
}
export interface ManuscriptFile {
  id: string;
  submission_id: string;
  storage_path: string;
  original_name: string;
  media_type: string;
  byte_size: number;
  version: number;
  verification_state: 'pending' | 'verified' | 'rejected' | 'deleting';
  created_at: string;
}
export interface SubmissionEvent {
  id: string;
  submission_id: string;
  kind: string;
  from_status: Status | null;
  to_status: Status;
  feedback: string | null;
  created_at: string;
}
export interface Notification {
  id: string;
  submission_id: string;
  message: string;
  read_at: string | null;
  created_at: string;
}
export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  state: 'new' | 'read' | 'handled';
  created_at: string;
}
export interface DraftInput {
  title: string;
  abstract: string;
  author_names: string;
  category: string;
  keywords: string[];
  publication_consent: boolean;
}
export const statusLabels: Record<Status, string> = {
  draft: 'Draft',
  submitted: 'Submitted / In process',
  under_review: 'Under review',
  published: 'Approved and published',
  rejected: 'Rejected',
};
export const statuses: Status[] = ['draft', 'submitted', 'under_review', 'published', 'rejected'];
export const categories = [
  'Computer Science',
  'Biology',
  'Physics',
  'Chemistry',
  'Engineering',
  'Social Sciences',
  'Humanities',
  'Multidisciplinary',
];
