import { useState } from 'react';
import { api } from '../api';

export default function MembersTab({ group, onChange }) {
  const [email, setEmail] = useState('');
  const [joinedAt, setJoinedAt] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function addMember(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.addMember(group.id, { email, joinedAt });
      setEmail('');
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function leave(userId) {
    const leftAt = window.prompt('Leave date (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
    if (!leftAt) return;
    setError('');
    try {
      await api.removeMember(group.id, userId, { leftAt });
      onChange();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <h3>Members</h3>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Joined</th>
              <th>Left</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {group.members.map((m) => (
              <tr key={`${m.userId}-${m.joinedAt}`}>
                <td>{m.name}</td>
                <td>{m.email}</td>
                <td>{m.joinedAt}</td>
                <td>{m.leftAt || '—'}</td>
                <td>
                  {m.isCurrentMember ? (
                    <span className="badge equal">Active</span>
                  ) : (
                    <span className="badge unequal">Left</span>
                  )}
                </td>
                <td>
                  {m.isCurrentMember && (
                    <button className="btn secondary" onClick={() => leave(m.userId)}>
                      Mark as left
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Add a member</h3>
        <p className="muted">
          The person must already have an account (register via the login page first), then add
          them here by email.
        </p>
        <form onSubmit={addMember}>
          <div className="form-row">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="form-row">
            <label>Joined on</label>
            <input type="date" value={joinedAt} onChange={(e) => setJoinedAt(e.target.value)} required />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Adding...' : 'Add member'}
          </button>
        </form>
      </div>
    </div>
  );
}
