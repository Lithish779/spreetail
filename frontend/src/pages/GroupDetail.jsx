import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import MembersTab from '../components/MembersTab';
import ExpensesTab from '../components/ExpensesTab';
import BalancesTab from '../components/BalancesTab';
import SettlementsTab from '../components/SettlementsTab';
import ImportTab from '../components/ImportTab';

const TABS = [
  { key: 'expenses', label: 'Expenses' },
  { key: 'balances', label: 'Balances' },
  { key: 'settlements', label: 'Settlements' },
  { key: 'members', label: 'Members' },
  { key: 'import', label: 'Import CSV' },
];

export default function GroupDetail() {
  const { id } = useParams();
  const [group, setGroup] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('expenses');

  async function load() {
    try {
      setGroup(await api.getGroup(id));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <div className="error-box">{error}</div>;
  if (!group) return <p className="muted">Loading...</p>;

  return (
    <div>
      <p>
        <Link to="/">&larr; All groups</Link>
      </p>
      <h2 style={{ marginTop: 0 }}>{group.name}</h2>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'expenses' && <ExpensesTab group={group} />}
      {tab === 'balances' && <BalancesTab group={group} />}
      {tab === 'settlements' && <SettlementsTab group={group} />}
      {tab === 'members' && <MembersTab group={group} onChange={load} />}
      {tab === 'import' && <ImportTab group={group} />}
    </div>
  );
}
