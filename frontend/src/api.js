const apiBase = import.meta.env.VITE_API_URL || '/api';

export async function apiRequest(path, { token, ...options } = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export { apiBase };
