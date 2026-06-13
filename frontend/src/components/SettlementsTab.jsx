import { useState, useEffect } from 'react';
import { api } from '../api';

export default function SettlementsTab({ group }) {
  const [payments, setPayments] = useState([]);
  const [error, setError] = useState('');
  const [fromUserId, setFromUserId] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const allMembers = group.members; // include past members - they might still be settling up

  async function load() {
    try {
      setPayments(await api.listPayments(group.id));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    if (allMembers.length >= 2) {
      setFromUserId(String(allMembers[0].userId));
      setToUserId(String(allMembers[1].userId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (fromUserId === toUserId) {
      setError('From and To must be different people.');
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      setError('Enter a positive amount.');
      return;
    }
    setBusy(true);
    try {
      await api.createPayment({
        groupId: group.id,
        fromUserId: parseInt(fromUserId, 10),
        toUserId: parseInt(toUserId, 10),
        amount: parseFloat(amount),
        date,
        notes,
      });
      setAmount('');
      setNotes('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <h3>Record a settlement</h3>
        <p className="muted">
          Use this when someone pays another person back directly (e.g. via UPI/cash) outside the
          app. This is also how the "Rohan paid Aisha back" type entries from the CSV import are
          recorded — as payments, not shared expenses.
        </p>
        <form onSubmit={submit}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-row" style={{ flex: 1 }}>
              <label>From (paid)</label>
              <select value={fromUserId} onChange={(e) => setFromUserId(e.target.value)}>
                {allMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row" style={{ flex: 1 }}>
              <label>To (received)</label>
              <select value={toUserId} onChange={(e) => setToUserId(e.target.value)}>
                {allMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-row" style={{ flex: 1 }}>
              <label>Amount (₹)</label>
              <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="form-row" style={{ flex: 1 }}>
              <label>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>
          <div className="form-row">
            <label>Notes (optional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Saving...' : 'Record settlement'}
          </button>
        </form>
      </div>

      <div className="card">
        <h3>Settlement history</h3>
        {payments.length === 0 && <p className="muted">No settlements recorded yet.</p>}
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>From</th>
              <th>To</th>
              <th>Amount</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>{p.date}</td>
                <td>{p.fromUser?.name}</td>
                <td>{p.toUser?.name}</td>
                <td>₹{p.amount}</td>
                <td className="muted">
                  {p.notes}
                  {p.source === 'import' && <span className="badge percentage" style={{ marginLeft: 4 }}>imported</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
