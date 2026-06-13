import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function GroupsList() {
  const [groups, setGroups] = useState([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      setGroups(await api.listGroups());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createGroup(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await api.createGroup({ name, baseCurrency: 'INR' });
      setName('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <h3>Your groups</h3>
        {groups.length === 0 && <p className="muted">No groups yet.</p>}
        {groups.map((g) => (
          <div key={g.id} className="settlement-row">
            <div>
              <Link to={`/groups/${g.id}`}>{g.name}</Link>
              <div className="muted">
                Base currency: {g.baseCurrency} · {g.isCurrentMember ? 'Current member' : `Left ${g.leftAt}`}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Create a new group</h3>
        <form onSubmit={createGroup} style={{ display: 'flex', gap: 8 }}>
          <input
            placeholder="Group name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
          />
          <button className="btn" type="submit" disabled={creating}>
            {creating ? 'Creating...' : 'Create'}
          </button>
        </form>
      </div>
    </div>
  );
}
