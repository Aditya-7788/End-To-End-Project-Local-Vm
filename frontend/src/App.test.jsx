import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { ChatPage } from './components/ChatPage';
import { Disclaimer } from './components/Disclaimer';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it('shows matching slots and asks for confirmation before booking', async () => {
    const doctor = {
      id: 'doctor-id',
      name: 'Dr. Meera Nair',
      specialty: 'Dermatology',
      clinic: 'Clear Skin Clinic'
    };
    const slot = {
      id: 'slot-id',
      doctor_id: doctor.id,
      starts_at: '2026-11-01T04:30:00.000Z',
      doctor_name: doctor.name,
      clinic: doctor.clinic
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ reply: 'Dermatology slots found.', doctors: [doctor], slots: [slot] })
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          reply: 'Please confirm: Dr. Meera Nair, Nov 1, 2026, 10:00 am IST.',
          doctors: [doctor],
          slots: [],
          pendingBooking: { doctorName: doctor.name, clinic: doctor.clinic, startsAt: slot.starts_at }
        })
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ reply: 'Booked: Dr. Meera Nair, Nov 1, 2026, 10:00 am IST.', doctors: [], slots: [] })
      });
    vi.stubGlobal('fetch', fetchMock);
    render(<ChatPage token="test-token" />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Your message' }), {
      target: { value: 'I have a rash tomorrow at 10 am.' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Select Dr\. Meera Nair.*Clear Skin Clinic.*IST/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Confirm booking' }));
    expect(await screen.findByText(/Booked: Dr\. Meera Nair/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
