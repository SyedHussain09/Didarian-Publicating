import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main
        className="mx-auto my-12 max-w-lg rounded-xl border border-slate-200 bg-white p-6"
        role="alert"
      >
        <h1 className="mb-4 font-serif text-2xl font-bold">This page could not be displayed</h1>
        <p className="mb-5 text-sm text-slate-600">
          Reload to try again. Saved submissions remain in your account; an interrupted upload may
          need verification or retry.
        </p>
        <button className="btn" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </main>
    );
  }
}
