const BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    throw new Error(data?.error || `Request failed: ${res.status}`);
  }
  return data;
}

export const api = {
  // auth
  register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  // groups
  listGroups: () => request('/groups'),
  createGroup: (body) => request('/groups', { method: 'POST', body: JSON.stringify(body) }),
  getGroup: (id) => request(`/groups/${id}`),
  addMember: (id, body) => request(`/groups/${id}/members`, { method: 'POST', body: JSON.stringify(body) }),
  removeMember: (id, userId, body) =>
    request(`/groups/${id}/members/${userId}/leave`, { method: 'PATCH', body: JSON.stringify(body || {}) }),
  listAllUsers: () => request('/groups/_/users'),

  // expenses
  listExpenses: (groupId) => request(`/expenses/group/${groupId}`),
  createExpense: (body) => request('/expenses', { method: 'POST', body: JSON.stringify(body) }),
  deleteExpense: (id) => request(`/expenses/${id}`, { method: 'DELETE' }),
  getBalances: (groupId) => request(`/expenses/group/${groupId}/balances`),
  listPayments: (groupId) => request(`/expenses/group/${groupId}/payments`),
  createPayment: (body) => request('/expenses/payments', { method: 'POST', body: JSON.stringify(body) }),

  // import
  previewImport: (groupId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request(`/import/group/${groupId}/preview`, { method: 'POST', body: fd });
  },
  applyBatch: (batchId) => request(`/import/batch/${batchId}/apply`, { method: 'POST' }),
  rejectBatch: (batchId) => request(`/import/batch/${batchId}/reject`, { method: 'POST' }),
  getBatch: (batchId) => request(`/import/batch/${batchId}`),
  listBatches: (groupId) => request(`/import/group/${groupId}/batches`),
};

export function setToken(token) {
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
}

export function getCurrentUser() {
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

export function setCurrentUser(user) {
  if (user) localStorage.setItem('user', JSON.stringify(user));
  else localStorage.removeItem('user');
}
