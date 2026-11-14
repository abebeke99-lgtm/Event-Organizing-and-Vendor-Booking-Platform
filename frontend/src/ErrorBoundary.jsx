import { Component, cloneElement } from 'react';
import Logo from './components/Logo.js';

export default class ErrorBoundary extends Component {
  state = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Customer dashboard section failed to render.', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <section className="panel" role="alert">
        <Logo size="md" variant="full" />
        <h2>This section could not be displayed.</h2>
        <p>Please try again. If the problem continues, refresh the page.</p>
        <button
          className="button"
          type="button"
          onClick={() => this.setState((state) => ({ error: null, retryKey: state.retryKey + 1 }))}
        >
          Try again
        </button>
      </section>;
    }

    return cloneElement(this.props.children, { key: this.state.retryKey });
  }
}
