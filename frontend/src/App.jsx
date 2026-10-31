import { useEffect, useState } from 'react';
import { apiRequest } from './api';
import { ChatPage } from './components/ChatPage';
import { Disclaimer } from './components/Disclaimer';

function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await apiRequest(`/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      onAuthenticated(result);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">CARE THAT STARTS WITH A CONVERSATION</p>
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p>Sign in to find a specialist and manage your appointments.</p>
        <Disclaimer />
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="email">Email address</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} />
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="button button-primary" disabled={loading}>{loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        <button className="text-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? 'New to CareFlow? Create an account' : 'Already registered? Sign in'}
        </button>
      </div>
    </main>
  );
}

function DoctorsPage({ token }) {
  const [doctors, setDoctors] = useState([]);
  const [specialty, setSpecialty] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    apiRequest(`/doctors${specialty ? `?specialty=${encodeURIComponent(specialty)}` : ''}`, { token })
      .then((result) => { if (active) setDoctors(result.doctors); })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [specialty, token]);

  return (
    <section className="content-page">
      <div className="page-heading"><p className="eyebrow">OUR CARE TEAM</p><h1>Find a doctor</h1><p>Browse our fictional demo clinicians by specialty.</p></div>
      <label className="filter-label" htmlFor="specialty">Filter specialty</label>
      <select id="specialty" value={specialty} onChange={(event) => setSpecialty(event.target.value)}>
        <option value="">All specialties</option>
        {['General Physician', 'Cardiology', 'Neurology', 'Dermatology', 'Pediatrics'].map((name) => <option key={name}>{name}</option>)}
      </select>
      {loading && <p role="status">Loading doctors...</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="doctor-grid">{doctors.map((doctor) => (
        <article className="doctor-profile" key={doctor.id}>
          <span className="doctor-avatar large">{doctor.name.split(' ').at(-1)?.[0]}</span>
          <p className="eyebrow">{doctor.specialty}</p><h2>{doctor.name}</h2><p>{doctor.bio}</p><span className="clinic-name">{doctor.clinic}</span>
        </article>
      ))}</div>
    </section>
  );
}

function AppointmentsPage({ token }) {
  const [appointments, setAppointments] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  async function refresh() {
    setLoading(true);
    try {
      const result = await apiRequest('/appointments/me', { token });
      setAppointments(result.appointments);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, [token]);
  async function cancel(id) {
    try {
      await apiRequest(`/appointments/${id}`, { token, method: 'DELETE' });
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    }
  }
  return (
    <section className="content-page">
      <div className="page-heading"><p className="eyebrow">YOUR VISITS</p><h1>My appointments</h1><p>Review or cancel your upcoming appointments.</p></div>
      {loading && <p role="status">Loading appointments...</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
      {!loading && appointments.length === 0 && <div className="empty-state"><span>♡</span><h2>No appointments yet</h2><p>Your confirmed visits will appear here.</p></div>}
      <div className="appointment-list">{appointments.map((appointment) => (
        <article className="appointment-card" key={appointment.id}>
          <div className="date-tile"><strong>{new Date(appointment.starts_at).toLocaleDateString(undefined, { day: '2-digit' })}</strong><span>{new Date(appointment.starts_at).toLocaleDateString(undefined, { month: 'short' })}</span></div>
          <div className="appointment-details"><h2>{appointment.doctor_name}</h2><p>{appointment.specialty} · {appointment.clinic}</p><span>{new Date(appointment.starts_at).toLocaleString()}</span></div>
          <button className="button button-secondary" onClick={() => cancel(appointment.id)}>Cancel</button>
        </article>
      ))}</div>
    </section>
  );
}

export default function App() {
  const [auth, setAuth] = useState(() => {
    try { return JSON.parse(localStorage.getItem('careflow-auth') || 'null'); } catch { return null; }
  });
  const [page, setPage] = useState('chat');
  function signOut() {
    localStorage.removeItem('careflow-auth');
    setAuth(null);
    setPage('chat');
  }
  function onAuthenticated(result) {
    const value = { token: result.token, user: result.user };
    localStorage.setItem('careflow-auth', JSON.stringify(value));
    setAuth(value);
  }
  if (!auth?.token) return <AuthPage onAuthenticated={onAuthenticated} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setPage('chat')} aria-label="CareFlow home"><span className="brand-mark">+</span>careflow<span className="brand-dot">.</span></button>
        <nav aria-label="Main navigation">
          <button className={page === 'chat' ? 'active' : ''} onClick={() => setPage('chat')}>Assistant</button>
          <button className={page === 'doctors' ? 'active' : ''} onClick={() => setPage('doctors')}>Find doctors</button>
          <button className={page === 'appointments' ? 'active' : ''} onClick={() => setPage('appointments')}>Appointments</button>
        </nav>
        <div className="account-menu"><span>{auth.user?.email}</span><button onClick={signOut}>Sign out</button></div>
      </header>
      <main>
        {page !== 'chat' && <div className="persistent-disclaimer"><Disclaimer /></div>}
        {page === 'chat' ? <ChatPage token={auth.token} /> : page === 'doctors' ? <DoctorsPage token={auth.token} /> : <AppointmentsPage token={auth.token} />}
      </main>
      <footer>CareFlow is a scheduling demo with fictional doctors. Not a substitute for professional medical care.</footer>
    </div>
  );
}
