import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import App from './App';
import { ChatPage } from './components/ChatPage';
import { Disclaimer } from './components/Disclaimer';

afterEach(cleanup);

describe('CareFlow frontend', () => {
  it('renders the chat experience and persistent medical disclaimer', () => {
    render(<ChatPage token="test-token" />);
    expect(screen.getByRole('heading', { name: 'How can we help?' })).toBeInTheDocument();
    expect(screen.getByText(/does not provide medical advice or diagnosis/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Your message' })).toBeInTheDocument();
  });

  it('shows the medical disclaimer on the sign-in page', () => {
    localStorage.removeItem('careflow-auth');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByText(/call your local emergency number/i)).toBeInTheDocument();
  });

  it('renders the standalone disclaimer banner', () => {
    render(<Disclaimer />);
    expect(screen.getByRole('note')).toHaveTextContent('This assistant suggests specialists only.');
  });
});
