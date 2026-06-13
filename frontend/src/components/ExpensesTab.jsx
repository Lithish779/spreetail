import { useState, useEffect } from 'react';
import { api } from '../api';

const SPLIT_TYPES = [
  { value: 'equal', label: 'Equal' },
  { value: 'unequal', label: 'Unequal (exact amounts)' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'share', label: 'Share (units)' },
];

export default function ExpensesTab({ group }) {
  const [expenses, setExpenses] = useState([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  // form state
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [paidByUserId, setPaidByUserId] = useState('');
  const [splitType, setSplitType] = useState('equal');
  const [selectedMembers, setSelectedMembers] = useState({}); // userId -> true (for equal)
  const [splitValues, setSplitValues] = useState({}); // userId -> value (for unequal/percentage/share)
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const activeMembers = group.members.filter((m) => m.isCurrentMember);

  async function load() {
    try {
      setExpenses(await api.listExpenses(group.id));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // default paidBy to first active member
    if (activeMembers.length && !paidByUserId) setPaidByUserId(String(activeMembers[0].userId));
    // default: all active members selected for equal split
    const init = {};
    activeMembers.forEach((m) => (init[m.userId] = true));
    setSelectedMembers(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMember(userId) {
    setSelectedMembers((prev) => ({ ...prev, [userId]: !prev[userId] }));
  }

  function setSplitValue(userId, val) {
    setSplitValues((prev) => ({ ...prev, [userId]: val }));
  }

  async function submit(e) {
    e.preventDefault();
    setError('');

    if (!description.trim() || !amount || !paidByUserId) {
      setError('Please fill in description, amount, and who paid.');
      return;
    }

    const body = {
      groupId: group.id,
      description,
      date,
      originalAmount: parseFloat(amount),
      originalCurrency: currency,
      exchangeRate: parseFloat(exchangeRate) || 1,
      paidByUserId: parseInt(paidByUserId, 10),
      splitType,
      notes,
    };

    if (splitType === 'equal') {
      body.participantUserIds = activeMembers.filter((m) => selectedMembers[m.userId]).map((m) => m.userId);
      if (body.participantUserIds.length === 0) {
        setError('Select at least one participant.');
        return;
      }
    } else {
      const details = {};
      for (const m of activeMembers) {
        const v = splitValues[m.userId];
        if (v !== undefined && v !== '' && parseFloat(v) !== 0) {
          let value = parseFloat(v);
          if (splitType === 'unequal') {
            // unequal amounts are entered in ORIGINAL currency; convert to base
            value = Math.round(value * (parseFloat(exchangeRate) || 1) * 100) / 100;
          }
          details[m.userId] = value;
        }
      }
      if (Object.keys(details).length === 0) {
        setError('Enter at least one split value.');
        return;
      }
      body.splitDetails = details;
    }

    setBusy(true);
    try {
      await api.createExpense(body);
      setDescription('');
      setAmount('');
      setNotes('');
      setSplitValues({});
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this expense? This affects everyone\'s balances.')) return;
    try {
      await api.deleteExpense(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && <div className="error-box">{error}</div>}

      <div className="flex-between" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Expenses</h3>
        <button className="btn" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : '+ Add expense'}
        </button>
      </div>

      {showForm && (
        <div className="card">
          <form onSubmit={submit}>
            <div className="form-row">
              <label>Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} required />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div className="form-row" style={{ flex: 1 }}>
                <label>Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div className="form-row" style={{ flex: 1 }}>
                <label>Amount (in original currency)</label>
                <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                <span className="muted">Negative amount = refund (reduces shares)</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div className="form-row" style={{ flex: 1 }}>
                <label>Currency</label>
                <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div className="form-row" style={{ flex: 1 }}>
                <label>Exchange rate to INR (1 if INR)</label>
                <input type="number" step="0.01" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <label>Paid by</label>
              <select value={paidByUserId} onChange={(e) => setPaidByUserId(e.target.value)} required>
                {activeMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <label>Split type</label>
              <select value={splitType} onChange={(e) => setSplitType(e.target.value)}>
                {SPLIT_TYPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {splitType === 'equal' && (
              <div className="form-row">
                <label>Split equally among</label>
                {activeMembers.map((m) => (
                  <label key={m.userId} style={{ display: 'block', fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={!!selectedMembers[m.userId]}
                      onChange={() => toggleMember(m.userId)}
                    />{' '}
                    {m.name}
                  </label>
                ))}
              </div>
            )}

            {splitType !== 'equal' && (
              <div className="form-row">
                <label>
                  {splitType === 'unequal' && 'Exact amount per person (original currency)'}
                  {splitType === 'percentage' && 'Percentage per person (need not sum to 100 — will be normalized)'}
                  {splitType === 'share' && 'Share units per person'}
                </label>
                {activeMembers.map((m) => (
                  <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ width: 80 }}>{m.name}</span>
                    <input
                      type="number"
                      step="0.01"
                      style={{ width: 100, padding: '4px 8px' }}
                      value={splitValues[m.userId] ?? ''}
                      onChange={(e) => setSplitValue(m.userId, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="form-row">
              <label>Notes (optional)</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Saving...' : 'Save expense'}
            </button>
          </form>
        </div>
      )}

      <div className="card">
        {expenses.length === 0 && <p className="muted">No expenses yet.</p>}
        {expenses.map((exp) => (
          <div key={exp.id} className="settlement-row" style={{ display: 'block' }}>
            <div className="flex-between">
              <div>
                <strong>{exp.description}</strong>{' '}
                <span className={`badge ${exp.splitType}`}>{exp.splitType}</span>
                {exp.isRefund && <span className="badge unequal" style={{ marginLeft: 4 }}>refund</span>}
                {exp.source === 'import' && <span className="badge percentage" style={{ marginLeft: 4 }}>imported</span>}
                <div className="muted">
                  {exp.date} · Paid by {exp.paidBy?.name} ·{' '}
                  {exp.originalCurrency !== 'INR'
                    ? `${exp.originalAmount} ${exp.originalCurrency} (₹${exp.amountBase})`
                    : `₹${exp.amountBase}`}
                </div>
                {exp.notes && <div className="muted">Note: {exp.notes}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn secondary" onClick={() => setExpandedId(expandedId === exp.id ? null : exp.id)}>
                  {expandedId === exp.id ? 'Hide' : 'Details'}
                </button>
                <button className="btn danger" onClick={() => remove(exp.id)}>
                  Delete
                </button>
              </div>
            </div>
            {expandedId === exp.id && (
              <ul className="share-list">
                {exp.ExpenseShares?.map((s) => (
                  <li key={s.id}>
                    <span>{s.User?.name}</span>
                    <span>
                      ₹{s.shareAmount}
                      {s.rawShareValue != null && exp.splitType !== 'unequal' && ` (${s.rawShareValue}${exp.splitType === 'percentage' ? '%' : ' units'})`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
