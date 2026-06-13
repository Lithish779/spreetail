import { useState, useEffect } from 'react';
import { api } from '../api';

export default function BalancesTab({ group }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [expandedUser, setExpandedUser] = useState(null);

  async function load() {
    try {
      setData(await api.getBalances(group.id));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <p className="muted">Loading...</p>;

  return (
    <div>
      <div className="card">
        <h3>Who pays whom</h3>
        <p className="muted">
          The simplified set of payments needed to settle every balance in this group.
        </p>
        {data.settlements.length === 0 && <p>Everyone is settled up. 🎉</p>}
        {data.settlements.map((s, i) => (
          <div key={i} className="settlement-row">
            <span>
              <strong>{s.from}</strong> owes <strong>{s.to}</strong>
            </span>
            <span className="amount negative">₹{s.amount.toFixed(2)}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Individual balances</h3>
        <p className="muted">
          Positive = the group owes this person. Negative = this person owes the group. Click a
          name to see exactly which expenses make up the number.
        </p>
        {data.members.map((m) => (
          <div key={m.userId}>
            <div className="settlement-row" style={{ cursor: 'pointer' }} onClick={() => setExpandedUser(expandedUser === m.userId ? null : m.userId)}>
              <span>{m.name}</span>
              <span className={`amount ${m.net >= 0 ? 'positive' : 'negative'}`}>
                {m.net >= 0 ? '+' : ''}₹{m.net.toFixed(2)}
              </span>
            </div>
            {expandedUser === m.userId && (
              <table style={{ marginBottom: 12 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Type</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {m.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.date}</td>
                      <td>{l.description}</td>
                      <td className="muted">
                        {l.type === 'paid' && 'Paid (fronted)'}
                        {l.type === 'share' && 'Their share'}
                        {l.type === 'payment_sent' && 'Settlement sent'}
                        {l.type === 'payment_received' && 'Settlement received'}
                      </td>
                      <td className={`amount ${l.amount >= 0 ? 'positive' : 'negative'}`}>
                        {l.amount >= 0 ? '+' : ''}₹{l.amount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3}><strong>Net</strong></td>
                    <td className={`amount ${m.net >= 0 ? 'positive' : 'negative'}`}>
                      <strong>{m.net >= 0 ? '+' : ''}₹{m.net.toFixed(2)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
