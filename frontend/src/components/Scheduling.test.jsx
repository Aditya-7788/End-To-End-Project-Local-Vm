import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { AppointmentsPage } from './AppointmentsPage';

const doctor = {
  id: '44f3ca01-e40a-49e9-9b17-cd96f26b6b34',
  name: 'Dr. Meera Nair',
  specialty: 'Dermatology',
  clinic: 'Clear Skin Clinic',
  bio: 'General dermatology consultations.'
};

function jsonResponse(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload
  };
}

function getTomorrow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const today = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const date = new Date(`${today.year}-${today.month}-${today.day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function makeSlot(date) {
  return {
    id: '661fa301-e40a-49e9-9b17-cd96f26b6b35',
    doctor_id: doctor.id,
    starts_at: `${date}T03:30:00.000Z`
  };
}

beforeEach(() => {
  localStorage.setItem('careflow-auth', JSON.stringify({
    token: 'test-token',
    user: { email: 'patient@example.test' }
  }));
  sessionStorage.clear();
  window.history.replaceState(null, '', window.location.pathname);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('doctor browsing and booking', () => {
  it('opens the shareable doctor drawer from a clickable doctor card', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('/doctors')) return jsonResponse(200, { doctors: [doctor] });
      if (String(url).includes('/slots?date=')) return jsonResponse(200, { slots: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Find doctors' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View Dr. Meera Nair' }));

    const dialog = await screen.findByRole('dialog', { name: /Dr\. Meera Nair/ });
    expect(window.location.hash).toBe(`#doctor=${doctor.id}`);
    expect(within(dialog).getByText('Clear Skin Clinic')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Choose today/ })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close doctor details' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.hash).toBe('');
    expect(screen.getByRole('button', { name: 'View Dr. Meera Nair' })).toHaveFocus();
  });

  it('enables confirmation after selecting a slot and explains a double-booking conflict', async () => {
    const tomorrow = getTomorrow();
    const slot = makeSlot(tomorrow);
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith('/doctors')) return jsonResponse(200, { doctors: [doctor] });
      if (String(url).includes('/slots?date=')) {
        return jsonResponse(200, { slots: String(url).endsWith(`date=${tomorrow}`) ? [slot] : [] });
      }
      if (String(url).endsWith('/appointments') && options.method === 'POST') {
        return jsonResponse(409, { error: 'That appointment slot is no longer available.' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Find doctors' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View Dr. Meera Nair' }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(tomorrow) }));

    const confirmButton = screen.getByRole('button', { name: 'Confirm booking' });
    expect(confirmButton).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: '9:00 am' }));
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, book this appointment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/just booked/i);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/doctors/${doctor.id}/slots?date=${tomorrow}`),
      expect.any(Object)
    ));
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith('/appointments') && options.method === 'POST')).toBe(true);
  });
});

describe('appointment cancellation', () => {
  it('confirms cancellation, removes the appointment, and shows a toast', async () => {
    const appointment = {
      id: '72f0a301-e40a-49e9-9b17-cd96f26b6b36',
      doctor_name: doctor.name,
      specialty: doctor.specialty,
      clinic: doctor.clinic,
      starts_at: `${getTomorrow()}T03:30:00.000Z`
    };
    const onToast = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { appointments: [appointment] }))
      .mockResolvedValueOnce({ status: 204, ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(<AppointmentsPage token="test-token" onNavigate={vi.fn()} onToast={onToast} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Cancel this appointment?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));

    expect(await screen.findByRole('heading', { name: 'No upcoming appointments' })).toBeInTheDocument();
    expect(onToast).toHaveBeenCalledWith('Appointment cancelled.');
    expect(fetchMock.mock.calls[1][0]).toContain(`/appointments/${appointment.id}`);
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });
});
