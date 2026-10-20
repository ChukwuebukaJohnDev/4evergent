import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useState } from 'react';

// App pulls in the whole route tree; Login is the only module that reaches
// out to the browser wallet extension, so stub it to keep this test isolated.
vi.mock('../pages/Login', () => ({ default: () => null }));

import { ErrorBoundary } from '../App';

function Boom(): never {
  throw new Error('Kaboom from render');
}

function Broken({ broken }: { broken: boolean }) {
  if (broken) throw new Error('Transient render failure');
  return <div>Recovered content</div>;
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders its children when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <div>All good</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('catches a thrown render error and renders the recovery screen', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByText('Kaboom from render')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
  });

  it('resets the boundary and re-renders children when "Try again" is clicked', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    function Harness() {
      const [broken, setBroken] = useState(true);
      return (
        <>
          <button onClick={() => setBroken(false)}>fix upstream</button>
          <ErrorBoundary>
            <Broken broken={broken} />
          </ErrorBoundary>
        </>
      );
    }

    render(<Harness />);

    expect(screen.getByText('Transient render failure')).toBeInTheDocument();

    // Resolve the underlying cause, then reset the boundary via "Try again".
    fireEvent.click(screen.getByRole('button', { name: 'fix upstream' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Recovered content')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });
});
