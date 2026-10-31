import { useState } from 'react';
import { apiRequest } from '../api';
import { Disclaimer } from './Disclaimer';

const quickReplies = [
  'I have a headache and fever',
  'Help me find a specialist',
  'I want to see available doctors'
];

export function ChatPage({ token }) {
  const [sessionId] = useState(() => {
    const stored = sessionStorage.getItem('careflow-session');
    if (stored) return stored;
    const created = globalThis.crypto?.randomUUID?.()
      || `careflow-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem('careflow-session', created);
    return created;
  });
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hello! Tell me what you would like help with, and I can suggest a medical specialty and help you find an appointment.' }
  ]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingBooking, setPendingBooking] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [slots, setSlots] = useState([]);

  async function sendMessage(value = draft) {
    const message = value.trim();
    if (!message || loading) return;
    setDraft('');
    setError('');
    setMessages((current) => [...current, { role: 'user', text: message }]);
    setLoading(true);
    try {
      const result = await apiRequest('/chat', {
        token,
        method: 'POST',
        body: JSON.stringify({ sessionId, message })
      });
      setMessages((current) => [...current, { role: 'assistant', text: result.reply }]);
      setPendingBooking(result.pendingBooking || null);
      setDoctors(result.doctors || []);
      setSlots(result.slots || []);
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
          <p>Share what brings you here. We can help you find a specialist and a time that works.</p>
        </div>
        <span className="online-badge"><span /> Scheduling assistant</span>
      </div>
      <Disclaimer />
      <div className="chat-panel">
        <div className="messages" aria-live="polite" aria-label="Conversation">
          {messages.map((message, index) => (
            <div className={`message-row ${message.role}`} key={`${message.role}-${index}`}>
              {message.role === 'assistant' && <span className="assistant-avatar">C</span>}
              <p className="message-bubble">{message.text}</p>
            </div>
          ))}
          {loading && <div className="typing" role="status"><span /><span /><span /> CareFlow is thinking</div>}
          {doctors.length > 0 && (
            <div className="inline-cards">
              {doctors.map((doctor) => (
                <article className="doctor-card" key={doctor.id}>
                  <span className="doctor-avatar">{doctor.name.split(' ').at(-1)?.[0]}</span>
                  <div><strong>{doctor.name}</strong><span>{doctor.specialty} · {doctor.clinic}</span></div>
                </article>
              ))}
            </div>
          )}
          {slots.length > 0 && (
            <div className="slot-list" aria-label="Available appointment slots">
              {slots.map((slot) => (
                <button className="slot-chip" key={slot.id} onClick={() => sendMessage(`I would like to select slot ${slot.id} with doctor ${slot.doctor_id}.`)}>
                  {new Date(slot.starts_at).toLocaleString()}
                </button>
              ))}
            </div>
          )}
          {pendingBooking && (
            <div className="confirm-card">
              <strong>Confirm this appointment?</strong>
              <span>{pendingBooking.doctorName} · {new Date(pendingBooking.startsAt).toLocaleString()}</span>
              <div className="confirm-actions">
                <button className="button button-primary" onClick={() => sendMessage('Yes, confirm this appointment.')}>Confirm booking</button>
                <button className="button button-secondary" onClick={() => sendMessage('Cancel this appointment.')}>Cancel</button>
              </div>
            </div>
          )}
          {error && <p className="error-message" role="alert">{error}</p>}
        </div>
        <form className="composer" onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
          <label className="sr-only" htmlFor="chat-message">Your message</label>
          <input id="chat-message" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Tell us what you need..." maxLength={2000} />
          <button className="send-button" type="submit" disabled={loading || !draft.trim()} aria-label="Send message">Send <span aria-hidden="true">→</span></button>
        </form>
        <div className="quick-replies" aria-label="Suggested messages">
          {quickReplies.map((reply) => <button key={reply} onClick={() => sendMessage(reply)} disabled={loading}>{reply}</button>)}
        </div>
      </div>
      <p className="privacy-note">Your conversation is private to your account. CareFlow uses fictional demo doctors.</p>
    </section>
  );
}
