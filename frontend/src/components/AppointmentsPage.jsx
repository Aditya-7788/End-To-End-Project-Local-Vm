import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../api';

function formatAppointmentDate(value, options) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...options }).format(new Date(value));
}

export function AppointmentsPage({ token, onNavigate, onToast }) {
  const [appointments, setAppointments] = useState([]);
  const [tab, setTab] = useState('upcoming');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const cancelButton = useRef(null);
  const cancelTrigger = useRef(null);

  async function loadAppointments() {
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest('/appointments/me', { token });
      setAppointments(result.appointments);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAppointments();
  }, [token]);

  useEffect(() => {
    if (!cancelTarget) {
      if (cancelTrigger.current?.isConnected) cancelTrigger.current.focus();
      else if (cancelTrigger.current) document.getElementById('appointment-tabs')?.focus();
      cancelTrigger.current = null;
      return undefined;
    }
    cancelButton.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !cancelling) {
        setCancelTarget(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector('[aria-labelledby="cancel-title"]');
      const focusable = [...dialog.querySelectorAll('button:not(:disabled)')];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable.at(-1).focus();
      } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
        event.preventDefault();
        focusable[0].focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [cancelTarget, cancelling]);

  const now = Date.now();
  const upcoming = useMemo(() => appointments.filter((appointment) => new Date(appointment.starts_at).getTime() >= now), [appointments, now]);
  const past = useMemo(() => appointments.filter((appointment) => new Date(appointment.starts_at).getTime() < now), [appointments, now]);
  const visibleAppointments = tab === 'upcoming' ? upcoming : past;

  async function confirmCancel() {
    if (!cancelTarget) return;
    const previousAppointments = appointments;
    setAppointments((current) => current.filter((appointment) => appointment.id !== cancelTarget.id));
    setCancelling(true);
    try {
      await apiRequest(`/appointments/${encodeURIComponent(cancelTarget.id)}`, { token, method: 'DELETE' });
      onToast?.('Appointment cancelled.');
      setCancelTarget(null);
    } catch (requestError) {
      setAppointments(previousAppointments);
      setError(requestError.message);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <section className="content-page appointments-page">
      <div className="page-heading">
        <p className="eyebrow">YOUR VISITS</p>
        <h1>My appointments</h1>
        <p>Your care plan, all in one place.</p>
      </div>
      <div id="appointment-tabs" className="appointment-tabs" role="tablist" aria-label="Appointment history" tabIndex="-1">
        <button type="button" role="tab" aria-selected={tab === 'upcoming'} className={tab === 'upcoming' ? 'selected' : ''} onClick={() => setTab('upcoming')}>
          Upcoming <span>{upcoming.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'past'} className={tab === 'past' ? 'selected' : ''} onClick={() => setTab('past')}>
          Past <span>{past.length}</span>
        </button>
      </div>

      {loading && <div className="appointment-loading" role="status">Loading your appointments...</div>}
      {error && (
        <div className="error-state compact-error" role="alert">
          <p>{error}</p><button className="button button-secondary" type="button" onClick={loadAppointments}>Retry</button>
        </div>
      )}
      {!loading && !error && visibleAppointments.length === 0 && (
        <div className="empty-state appointments-empty">
          <span aria-hidden="true">♡</span>
          <h2>{tab === 'upcoming' ? 'No upcoming appointments' : 'No past appointments'}</h2>
          <p>{tab === 'upcoming' ? 'When you book a visit, it will appear here.' : 'Your completed visits will appear here.'}</p>
          {tab === 'upcoming' && <button className="button button-primary" type="button" onClick={() => onNavigate('doctors')}>Find doctors</button>}
        </div>
      )}
      {!loading && !error && visibleAppointments.length > 0 && (
        <div className="appointment-list" role="tabpanel" aria-label={`${tab} appointments`}>
          {visibleAppointments.map((appointment) => (
            <article className="appointment-card" key={appointment.id}>
              <div className="date-tile">
                <strong>{formatAppointmentDate(appointment.starts_at, { day: '2-digit' })}</strong>
                <span>{formatAppointmentDate(appointment.starts_at, { month: 'short' })}</span>
              </div>
              <div className="appointment-details">
                <h2>{appointment.doctor_name}</h2>
                <p>{appointment.specialty} · {appointment.clinic}</p>
                <span>{formatAppointmentDate(appointment.starts_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} IST</span>
              </div>
              <span className={`status-chip ${tab === 'upcoming' ? 'status-upcoming' : 'status-past'}`}>{tab === 'upcoming' ? 'Confirmed' : 'Completed'}</span>
              {tab === 'upcoming' && (
                <button className="button button-secondary cancel-button" type="button" onClick={(event) => { cancelTrigger.current = event.currentTarget; setCancelTarget(appointment); }}>Cancel</button>
              )}
            </article>
          ))}
        </div>
      )}

      {cancelTarget && (
        <div className="dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !cancelling) setCancelTarget(null);
        }}>
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
            <span className="dialog-icon" aria-hidden="true">!</span>
            <h2 id="cancel-title">Cancel this appointment?</h2>
            <p>{cancelTarget.doctor_name} · {formatAppointmentDate(cancelTarget.starts_at, { dateStyle: 'medium', timeStyle: 'short' })} IST</p>
            <div className="dialog-actions">
              <button type="button" className="button button-secondary" disabled={cancelling} onClick={() => setCancelTarget(null)}>Keep appointment</button>
              <button ref={cancelButton} type="button" className="button button-danger" disabled={cancelling} onClick={confirmCancel}>{cancelling ? 'Cancelling...' : 'Yes, cancel'}</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
