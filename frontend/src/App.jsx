import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from './api';
import { ChatPage } from './components/ChatPage';
import { Disclaimer } from './components/Disclaimer';
import { AppointmentsPage } from './components/AppointmentsPage';
import { DoctorDrawer } from './components/DoctorDrawer';
import { FindDoctorsPage } from './components/FindDoctorsPage';

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

export default function App() {
  const [auth, setAuth] = useState(() => {
    try { return JSON.parse(localStorage.getItem('careflow-auth') || 'null'); } catch { return null; }
  });
  const [page, setPage] = useState(() => window.location.hash.startsWith('#doctor=') ? 'doctors' : 'chat');
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState(() => window.location.hash.startsWith('#doctor=') ? window.location.hash.slice(8) : '');
  const returnFocusTarget = useRef(null);
  const [toast, setToast] = useState('');
  const [manualDark, setManualDark] = useState(null);
  const [systemDark, setSystemDark] = useState(false);
  const toastTimer = useRef(null);

  const showToast = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3500);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const closeDoctorDrawer = useCallback(() => {
    setSelectedDoctor(null);
    setSelectedDoctorId('');
    if (window.location.hash.startsWith('#doctor=')) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  }, []);

  const openDoctor = useCallback((doctor, triggerElement) => {
    returnFocusTarget.current = triggerElement || (document.activeElement === document.body ? null : document.activeElement);
    setSelectedDoctor(doctor);
    setSelectedDoctorId(doctor.id);
    if (window.location.hash !== `#doctor=${doctor.id}`) {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}#doctor=${doctor.id}`);
    }
  }, []);

  const navigate = useCallback((nextPage) => {
    if (selectedDoctorId) closeDoctorDrawer();
    setPage(nextPage);
  }, [closeDoctorDrawer, selectedDoctorId]);

  useEffect(() => {
    const hashChanged = () => {
      const id = window.location.hash.startsWith('#doctor=') ? window.location.hash.slice(8) : '';
      setSelectedDoctorId(id);
      if (id) setPage('doctors');
      else setSelectedDoctor(null);
    };
    window.addEventListener('hashchange', hashChanged);
    window.addEventListener('popstate', hashChanged);
    return () => {
      window.removeEventListener('hashchange', hashChanged);
      window.removeEventListener('popstate', hashChanged);
    };
  }, []);

  useEffect(() => {
    if (!selectedDoctorId || selectedDoctor?.id === selectedDoctorId && selectedDoctor.bio) return;
    let active = true;
    setSelectedDoctor(null);
    apiRequest('/doctors', { token: auth.token })
      .then(({ doctors }) => {
        if (!active) return;
        const match = doctors.find((doctor) => doctor.id === selectedDoctorId);
        if (match) setSelectedDoctor(match);
        else showToast('That doctor could not be found.');
      })
      .catch((requestError) => {
        if (active) showToast(requestError.message);
      });
    return () => { active = false; };
  }, [auth?.token, selectedDoctorId, showToast]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    setSystemDark(media.matches);
    const update = (event) => setSystemDark(event.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  function signOut() {
    localStorage.removeItem('careflow-auth');
    setAuth(null);
    setPage('chat');
    closeDoctorDrawer();
  }
  function onAuthenticated(result) {
    const value = { token: result.token, user: result.user };
    localStorage.setItem('careflow-auth', JSON.stringify(value));
    setAuth(value);
  }
  if (!auth?.token) return <AuthPage onAuthenticated={onAuthenticated} />;

  const darkMode = manualDark ?? systemDark;

  return (
    <div className="app-shell" data-theme={darkMode ? 'dark' : 'light'}>
      <header className="topbar">
        <button className="brand" type="button" onClick={() => navigate('chat')} aria-label="CareFlow home"><span className="brand-mark">+</span>careflow<span className="brand-dot">.</span></button>
        <nav aria-label="Main navigation">
          <button type="button" className={page === 'chat' ? 'active' : ''} aria-current={page === 'chat' ? 'page' : undefined} onClick={() => navigate('chat')}>Assistant</button>
          <button type="button" className={page === 'doctors' ? 'active' : ''} aria-current={page === 'doctors' ? 'page' : undefined} onClick={() => navigate('doctors')}>Find doctors</button>
          <button type="button" className={page === 'appointments' ? 'active' : ''} aria-current={page === 'appointments' ? 'page' : undefined} onClick={() => navigate('appointments')}>Appointments</button>
        </nav>
        <div className="account-menu">
          <button className="theme-toggle" type="button" aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`} aria-pressed={darkMode} onClick={() => setManualDark(!darkMode)}>{darkMode ? '☼' : '◐'}</button>
          <span>{auth.user?.email}</span><button type="button" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main>
        {page !== 'chat' && <div className="persistent-disclaimer"><Disclaimer /></div>}
        {page === 'chat'
          ? <ChatPage token={auth.token} onDoctorSelect={openDoctor} />
          : page === 'doctors'
            ? <FindDoctorsPage token={auth.token} onSelectDoctor={openDoctor} />
            : <AppointmentsPage token={auth.token} onNavigate={navigate} onToast={showToast} />}
      </main>
      <footer>CareFlow is a scheduling demo with fictional doctors. Not a substitute for professional medical care.</footer>
      {selectedDoctor && (
        <DoctorDrawer
          key={selectedDoctor.id}
          doctor={selectedDoctor}
          token={auth.token}
          returnFocusElement={returnFocusTarget.current}
          onClose={closeDoctorDrawer}
          onNavigate={navigate}
          onToast={showToast}
        />
      )}
      {toast && <div className="toast" role="status"><span>{toast}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast('')}>×</button></div>}
    </div>
  );
}
