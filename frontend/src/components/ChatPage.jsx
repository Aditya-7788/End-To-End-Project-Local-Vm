import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api';
import { Disclaimer } from './Disclaimer';
import { formatClinicTime } from './DoctorDrawer';

const quickReplies = [
  'I have a headache and fever',
  'Find me a specialist',
  'Show available doctors'
];

function messageTime() {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date());
}

export function ChatPage({ token, onDoctorSelect }) {
  const [sessionId] = useState(() => {
    const stored = sessionStorage.getItem('careflow-session');
    if (stored) return stored;
    const created = globalThis.crypto?.randomUUID?.()
      || `careflow-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem('careflow-session', created);
    return created;
  });
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hello! Tell me what you would like help with, and I can suggest a medical specialty and help you find an appointment.', time: messageTime() }
  ]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingBooking, setPendingBooking] = useState(null);
  const [showDisclaimer, setShowDisclaimer] = useState(() => sessionStorage.getItem('careflow-disclaimer-dismissed') !== 'true');
  const messagesEnd = useRef(null);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  async function sendMessage(value = draft) {
    const message = value.trim();
    if (!message || loading) return;
    setDraft('');
    setError('');
    setMessages((current) => [...current, { role: 'user', text: message, time: messageTime() }]);
    setLoading(true);
    try {
      const result = await apiRequest('/chat', {
        token,
        method: 'POST',
        body: JSON.stringify({ sessionId, message })
      });
      setMessages((current) => [...current, {
        role: 'assistant',
        text: result.reply,
        time: messageTime(),
        doctors: result.doctors || [],
        slots: result.slots || []
      }]);
      setPendingBooking(result.pendingBooking || null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="chat-layout">
      <div className="chat-heading">
        <div>
          <p className="eyebrow">YOUR CARE, MADE SIMPLE</p>
          <h1>How can we help?</h1>
          <p>Thoughtful guidance to help you find the right care and time.</p>
        </div>
        <span className="online-badge"><span /> Scheduling assistant</span>
      </div>
      {showDisclaimer && (
        <div className="chat-disclaimer">
          <Disclaimer />
          <button type="button" onClick={() => { sessionStorage.setItem('careflow-disclaimer-dismissed', 'true'); setShowDisclaimer(false); }} aria-label="Dismiss medical disclaimer">×</button>
        </div>
      )}
      <div className="chat-panel">
        <div className="messages" aria-live="polite" aria-label="Conversation">
          {messages.map((message, index) => (
            <div className={`message-group ${message.role}`} key={`${message.role}-${index}`}>
              <div className={`message-row ${message.role}`}>
                {message.role === 'assistant' && <span className="assistant-avatar">C</span>}
                <p className="message-bubble">{message.text}</p>
              </div>
              <time className="message-timestamp">{message.time}</time>
              {message.role === 'assistant' && message.doctors?.length > 0 && (
                <div className="inline-cards">
                  {message.doctors.map((doctor) => (
                    <button className="doctor-card" key={doctor.id} type="button" aria-label={`View ${doctor.name}`} onClick={(event) => onDoctorSelect?.(doctor, event.currentTarget)}>
                      <span className="doctor-avatar">{doctor.name.replace(/^Dr\.\s*/i, '').split(' ').map((part) => part[0]).slice(0, 2).join('')}</span>
                      <span className="chat-doctor-details"><strong>{doctor.name}</strong><span>{doctor.specialty} · {doctor.clinic}</span></span>
                      <span className="card-arrow" aria-hidden="true">→</span>
                    </button>
                  ))}
                </div>
              )}
              {message.role === 'assistant' && message.slots?.length > 0 && (
                <div className="chat-slot-results" aria-label="Available appointment slots">
                  {message.slots.map((slot) => {
                    const doctor = message.doctors.find((item) => item.id === slot.doctor_id);
                    const doctorName = slot.doctor_name || doctor?.name || 'Doctor';
                    const clinic = slot.clinic || doctor?.clinic;
                    return (
                      <button
                        className="chat-slot-card"
                        key={slot.id}
                        type="button"
                        aria-label={`Select ${doctorName}${clinic ? ` ${clinic}` : ''} ${formatClinicTime(slot.starts_at)}`}
                        onClick={() => sendMessage(`I would like to select slot ${slot.id} with doctor ${slot.doctor_id}.`)}
                      >
                        <span className="chat-slot-doctor">{doctorName}</span>
                        <span className="chat-slot-clinic">{clinic}</span>
                        <strong>{formatClinicTime(slot.starts_at)}</strong>
                        <span className="card-arrow" aria-hidden="true">→</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {loading && <div className="typing" role="status" aria-label="CareFlow is typing"><span /><span /><span /> CareFlow is thinking</div>}
          {pendingBooking && (
            <div className="confirm-card">
              <strong>Confirm this appointment?</strong>
              <span>{pendingBooking.doctorName}{pendingBooking.clinic ? ` · ${pendingBooking.clinic}` : ''} · {formatClinicTime(pendingBooking.startsAt)}</span>
              <div className="confirm-actions">
                <button className="button button-primary" type="button" disabled={loading} onClick={() => sendMessage('Yes, confirm this appointment.')}>Confirm booking</button>
                <button className="button button-secondary" type="button" disabled={loading} onClick={() => sendMessage('Cancel this appointment.')}>Cancel</button>
              </div>
            </div>
          )}
          {error && <p className="error-message" role="alert">{error}</p>}
          <div ref={messagesEnd} />
        </div>
        <form className="composer" onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
          <label className="sr-only" htmlFor="chat-message">Your message</label>
          <textarea
            id="chat-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Tell us what you need..."
            maxLength={2000}
            rows={1}
          />
          <button className="send-button" type="submit" disabled={loading || !draft.trim()} aria-label="Send message">Send <span aria-hidden="true">→</span></button>
        </form>
        <div className="quick-replies" aria-label="Suggested messages">
          {quickReplies.map((reply) => <button type="button" key={reply} onClick={() => sendMessage(reply)} disabled={loading}>{reply}</button>)}
        </div>
      </div>
      <p className="privacy-note">Your conversation is private to your account. CareFlow uses fictional demo doctors.</p>
    </section>
  );
}
