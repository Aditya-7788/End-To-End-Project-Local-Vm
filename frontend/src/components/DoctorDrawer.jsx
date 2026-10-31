import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../api';

const groups = [
  { label: 'Morning', start: 5, end: 12 },
  { label: 'Afternoon', start: 12, end: 17 },
  { label: 'Evening', start: 17, end: 24 }
];

function getLocalDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getNextDates() {
  const today = getLocalDate();
  const start = new Date(`${today}T00:00:00.000Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function formatDate(value, options) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...options })
    .format(new Date(`${value}T12:00:00.000Z`));
}

export function formatClinicTime(value) {
  return `${new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))} IST`;
}

function initials(name = '') {
  return name.replace(/^Dr\.\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function timeParts(value) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(value));
  return Number(parts.find((part) => part.type === 'hour')?.value || 0);
}

export function DoctorDrawer({ doctor, token, onClose, onNavigate, onToast, returnFocusElement }) {
  const dates = useMemo(getNextDates, []);
  const [selectedDate, setSelectedDate] = useState(dates[0]);
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [error, setError] = useState('');
  const closeButton = useRef(null);
  const previousFocus = useRef(null);

  async function loadSlots(date = selectedDate) {
    setLoading(true);
    setError('');
    setSlots([]);
    setSelectedSlot(null);
    setConfirming(false);
    try {
      const result = await apiRequest(
        `/doctors/${encodeURIComponent(doctor.id)}/slots?date=${encodeURIComponent(date)}`,
        { token }
      );
      setSlots(result.slots);
      setSelectedSlot(null);
      setConfirming(false);
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    previousFocus.current = returnFocusElement || (document.activeElement === document.body ? null : document.activeElement);
    closeButton.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = event.currentTarget.querySelector('[role="dialog"]');
      const focusable = [...dialog.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus.current?.focus?.();
    };
  }, [onClose]);

  useEffect(() => {
    loadSlots(selectedDate);
  }, [doctor.id, selectedDate, token]);

  const groupedSlots = groups.map((group) => ({
    ...group,
    slots: slots.filter((slot) => {
      const hour = timeParts(slot.starts_at);
      return hour >= group.start && hour < group.end;
    })
  })).filter((group) => group.slots.length > 0);

  async function confirmBooking() {
    if (!selectedSlot) return;
    setBooking(true);
    setError('');
    try {
      await apiRequest('/appointments', {
        token,
        method: 'POST',
        body: JSON.stringify({ doctorId: doctor.id, slotId: selectedSlot.id, confirmed: true })
      });
      setBooked(true);
      setConfirming(false);
      onToast?.(`${doctor.name} appointment booked.`);
    } catch (requestError) {
      if (requestError.status === 409) {
        const refreshed = await loadSlots(selectedDate);
        if (refreshed) setError('That time was just booked. Please choose another available slot.');
      } else {
        setError(requestError.message);
      }
    } finally {
      setBooking(false);
    }
  }

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="doctor-drawer" role="dialog" aria-modal="true" aria-labelledby="doctor-drawer-title">
        <header className="drawer-header">
          <div className="doctor-detail-heading">
            <span className="doctor-avatar doctor-avatar-xl" aria-hidden="true">{initials(doctor.name)}</span>
            <div>
              <span className="specialty-chip">{doctor.specialty}</span>
              <h2 id="doctor-drawer-title">{doctor.name}</h2>
            </div>
          </div>
          <button ref={closeButton} className="icon-button" type="button" onClick={onClose} aria-label="Close doctor details">×</button>
        </header>

        <div className="drawer-content">
          <p className="drawer-clinic">{doctor.clinic}</p>
          <p className="drawer-bio">{doctor.bio || 'Schedule a consultation with this CareFlow demo clinician.'}</p>
          <div className="section-heading">
            <div><h3>Choose a day</h3><p>Available appointments in the next 7 days</p></div>
          </div>
          <div className="date-strip" aria-label="Choose appointment date">
            {dates.map((date, index) => (
              <button
                type="button"
                key={date}
                className={`date-chip ${selectedDate === date ? 'selected' : ''}`}
                aria-label={`Choose ${index === 0 ? 'today' : formatDate(date, { weekday: 'long' })} ${date}`}
                aria-pressed={selectedDate === date}
                onClick={() => setSelectedDate(date)}
              >
                <span>{index === 0 ? 'Today' : formatDate(date, { weekday: 'short' })}</span>
                <strong>{formatDate(date, { day: 'numeric' })}</strong>
                <small>{formatDate(date, { month: 'short' })}</small>
              </button>
            ))}
          </div>

          <div className="section-heading slots-heading"><div><h3>Available times</h3><p>{formatDate(selectedDate, { weekday: 'long', month: 'long', day: 'numeric' })}</p></div></div>
          {loading && <div className="slot-skeletons" role="status" aria-label="Loading available times"><span /><span /><span /></div>}
          {error && <p className="inline-error" role="alert">{error}</p>}
          {!loading && !error && slots.length === 0 && (
            <div className="drawer-empty"><span aria-hidden="true">◷</span><p>No available times this day. Try another date.</p></div>
          )}
          {!loading && !error && groupedSlots.map((group) => (
            <section className="slot-group" key={group.label} aria-label={`${group.label} slots`}>
              <h4>{group.label}</h4>
              <div className="slot-grid">
                {group.slots.map((slot) => {
                  const past = new Date(slot.starts_at).getTime() <= Date.now();
                  const selected = selectedSlot?.id === slot.id;
                  return (
                    <button
                      type="button"
                      key={slot.id}
                      disabled={past}
                      aria-pressed={selected}
                      className={`drawer-slot ${selected ? 'selected' : ''} ${past ? 'past' : ''}`}
                      onClick={() => { setSelectedSlot(slot); setConfirming(false); setError(''); }}
                    >
                      {formatClinicTime(slot.starts_at).split(', ').at(-1)?.replace(' IST', '')}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {confirming && selectedSlot && (
            <section className="booking-review" aria-label="Review appointment">
              <p>Confirm this appointment?</p>
              <strong>{doctor.name}</strong>
              <span>{doctor.clinic} · {formatClinicTime(selectedSlot.starts_at)}</span>
              <button className="button button-primary" type="button" disabled={booking} onClick={confirmBooking}>
                {booking ? 'Booking...' : 'Yes, book this appointment'}
              </button>
            </section>
          )}
          {booked && (
            <section className="booking-success" role="status">
              <span className="success-check" aria-hidden="true">✓</span>
              <h3>Booked</h3>
              <p>{doctor.name} · {formatClinicTime(selectedSlot.starts_at)}</p>
              <button className="button button-primary" type="button" onClick={() => onNavigate('appointments')}>View appointments</button>
            </section>
          )}
        </div>

        {!booked && (
          <footer className="drawer-footer">
            <div className="selected-summary">
              <span>{selectedSlot ? 'Selected time' : 'Choose a time'}</span>
              <strong>{selectedSlot ? formatClinicTime(selectedSlot.starts_at) : 'No slot selected'}</strong>
            </div>
            <button
              className="button button-primary"
              type="button"
              disabled={!selectedSlot || loading || booking}
              onClick={() => setConfirming(true)}
            >
              Confirm booking
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}
