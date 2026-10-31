import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api';

const specialties = ['Cardiology', 'Dermatology', 'General Physician', 'Neurology', 'Pediatrics'];

function DoctorInitials({ name }) {
  return name.replace(/^Dr\.\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function DoctorSkeleton() {
  return (
    <div className="doctor-skeleton" aria-hidden="true">
      <span className="skeleton-avatar" /><span className="skeleton-line short" />
      <span className="skeleton-line medium" /><span className="skeleton-line long" />
    </div>
  );
}

export function FindDoctorsPage({ token, onSelectDoctor }) {
  const [doctors, setDoctors] = useState([]);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [specialty, setSpecialty] = useState('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadDoctors() {
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest('/doctors', { token });
      setDoctors(result.doctors);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDoctors();
  }, [token]);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 250);
    return () => clearTimeout(timeout);
  }, [query]);

  const counts = useMemo(() => Object.fromEntries(
    specialties.map((name) => [name, doctors.filter((doctor) => doctor.specialty === name).length])
  ), [doctors]);
  const visibleDoctors = useMemo(() => doctors
    .filter((doctor) => specialty === 'All' || doctor.specialty === specialty)
    .filter((doctor) => !debouncedQuery || [doctor.name, doctor.clinic, doctor.specialty]
      .some((value) => value.toLowerCase().includes(debouncedQuery)))
    .sort((left, right) => left.name.localeCompare(right.name)), [doctors, debouncedQuery, specialty]);

  function clearFilters() {
    setQuery('');
    setDebouncedQuery('');
    setSpecialty('All');
  }

  return (
    <section className="content-page doctors-page">
      <div className="page-heading">
        <p className="eyebrow">OUR CARE TEAM</p>
        <h1>Find a doctor</h1>
        <p>Meet our fictional demo clinicians and find a time that works for you.</p>
      </div>
      <div className="doctor-controls">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Search doctors</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, clinic, or specialty"
          />
          {query && <button type="button" className="clear-search" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
        </label>
        <div className="sort-label">Sorted A–Z</div>
      </div>
      <div className="filter-tabs" role="group" aria-label="Filter doctors by specialty">
        <button type="button" className={specialty === 'All' ? 'selected' : ''} aria-pressed={specialty === 'All'} onClick={() => setSpecialty('All')}>
          All <span>{doctors.length}</span>
        </button>
        {specialties.map((name) => (
          <button type="button" key={name} className={specialty === name ? 'selected' : ''} aria-pressed={specialty === name} onClick={() => setSpecialty(name)}>
            {name} <span>{counts[name] || 0}</span>
          </button>
        ))}
      </div>

      {loading && <div className="doctor-grid" role="status" aria-label="Loading doctors">{Array.from({ length: 6 }, (_, index) => <DoctorSkeleton key={index} />)}</div>}
      {error && (
        <div className="error-state" role="alert">
          <span aria-hidden="true">!</span><h2>We couldn't load the care team</h2><p>{error}</p>
          <button type="button" className="button button-primary" onClick={loadDoctors}>Retry</button>
        </div>
      )}
      {!loading && !error && visibleDoctors.length === 0 && (
        <div className="empty-state doctor-empty">
          <span aria-hidden="true">⌕</span>
          <h2>No doctors found</h2>
          <p>Try a different search or clear your filters.</p>
          <button type="button" className="button button-secondary" onClick={clearFilters}>Clear filters</button>
        </div>
      )}
      {!loading && !error && visibleDoctors.length > 0 && (
        <div className="doctor-grid">
          {visibleDoctors.map((doctor, index) => (
            <button
              type="button"
              className="doctor-profile"
              key={doctor.id}
              style={{ '--card-index': index }}
              aria-label={`View ${doctor.name}`}
              onClick={(event) => onSelectDoctor(doctor, event.currentTarget)}
            >
              <span className="doctor-avatar large" aria-hidden="true"><DoctorInitials name={doctor.name} /></span>
              <span className="specialty-chip">{doctor.specialty}</span>
              <strong className="doctor-profile-name">{doctor.name}</strong>
              <span className="doctor-profile-clinic">{doctor.clinic}</span>
              <span className="doctor-profile-bio">{doctor.bio}</span>
              <span className="doctor-card-cta">View availability <span aria-hidden="true">→</span></span>
            </button>
          ))}
        </div>
      )}
      <p className="fictional-notice">CareFlow uses fictional demo doctors and sample appointment availability.</p>
    </section>
  );
}
