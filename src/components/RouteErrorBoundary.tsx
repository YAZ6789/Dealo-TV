import { Component, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, TriangleAlert } from 'lucide-react';

interface Props {
  /** Changing it (the route) clears the error, so the rest of the app keeps working. */
  resetKey: string;
  children: ReactNode;
}

/** Keeps one broken page from blanking the whole app; shows a way out instead. */
export class RouteErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: Error) {
    console.error('Page failed to render', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return (
      <div className="page">
        <div className="panel panel--pad stack" role="alert" style={{ maxWidth: 640 }}>
          <div className="cluster">
            <TriangleAlert size={20} className="accent" />
            <strong>{offline ? "You're offline and this page hasn't been saved yet" : "This page didn't load"}</strong>
          </div>
          <p className="dim" style={{ margin: 0 }}>
            {offline
              ? 'Open it once while online and it will work offline from then on. Your library is safe on this device.'
              : 'Usually that means Dealo TV was just updated. Reloading picks up the new version — your library is safe on this device.'}
          </p>
          <div className="cluster">
            <button className="btn btn--primary" onClick={() => location.reload()}>
              <RefreshCw size={16} /> Reload
            </button>
            <Link className="btn" to="/">
              Go home
            </Link>
          </div>
          <details className="hint">
            <summary>Details</summary>
            <code>{error.message}</code>
          </details>
        </div>
      </div>
    );
  }
}
