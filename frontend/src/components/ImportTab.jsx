import { useState, useRef } from 'react';
import { api } from '../api';

export default function ImportTab({ group }) {
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null); // { batchId, summary, report }
  const [result, setResult] = useState(null); // applied result
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();

  async function onFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const data = await api.previewImport(group.id, file);
      setPreview(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    setError('');
    try {
      const data = await api.applyBatch(preview.batchId);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    setError('');
    try {
      await api.rejectBatch(preview.batchId);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setPreview(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div>
      {error && <div className="error-box">{error}</div>}

      {!preview && (
        <div className="card">
          <h3>Import expenses_export.csv</h3>
          <p className="muted">
            Upload the spreadsheet export. The app will analyze every row, surface every data
            problem it finds, and show you exactly how it plans to handle each one — nothing is
            written to the database until you approve.
          </p>
          <div className="dropzone">
            <input ref={fileRef} type="file" accept=".csv" onChange={onFileChange} disabled={busy} />
            {busy && <p>Analyzing...</p>}
          </div>
        </div>
      )}

      {preview && !result && (
        <>
          <div className="card">
            <h3>Import preview — {preview.summary.totalRows} rows analyzed</h3>
            <div className="summary-grid">
              <div className="summary-stat">
                <div className="num">{preview.summary.toImport}</div>
                <div className="label">To import as expenses</div>
              </div>
              <div className="summary-stat">
                <div className="num">{preview.summary.toRecordAsPayment}</div>
                <div className="label">To record as settlements</div>
              </div>
              <div className="summary-stat">
                <div className="num">{preview.summary.skipped}</div>
                <div className="label">Skipped (duplicates/invalid)</div>
              </div>
              <div className="summary-stat">
                <div className="num">{preview.summary.flaggedForReview}</div>
                <div className="label">Flagged for manual review</div>
              </div>
            </div>
            <p>
              Review the anomaly report below. Nothing has been written to the database yet.
              Approve to apply these changes, or reject to discard this import entirely.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={approve} disabled={busy}>
                {busy ? 'Applying...' : 'Approve and apply'}
              </button>
              <button className="btn danger" onClick={reject} disabled={busy}>
                Reject
              </button>
            </div>
          </div>

          <AnomalyReport report={preview.report} />
        </>
      )}

      {result && (
        <>
          <div className="card">
            <h3>Import applied ✅</h3>
            <div className="summary-grid">
              <div className="summary-stat">
                <div className="num">{result.created.expenses}</div>
                <div className="label">Expenses created</div>
              </div>
              <div className="summary-stat">
                <div className="num">{result.created.payments}</div>
                <div className="label">Settlements recorded</div>
              </div>
              <div className="summary-stat">
                <div className="num">{result.created.skipped}</div>
                <div className="label">Rows skipped</div>
              </div>
            </div>
            {result.created.errors.length > 0 && (
              <div className="error-box">
                <strong>Errors during apply:</strong>
                <ul>
                  {result.created.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            <button className="btn secondary" onClick={startOver}>
              Import another file
            </button>
          </div>

          <AnomalyReport report={result.report} title="Final import report" />
        </>
      )}
    </div>
  );
}

const ACTION_LABELS = {
  imported: 'Imported',
  recorded_as_payment: 'Recorded as settlement',
  skipped: 'Skipped',
  skipped_duplicate: 'Skipped (duplicate)',
  flagged_for_review: 'Flagged for review',
};

function AnomalyReport({ report, title = 'Anomaly report' }) {
  return (
    <div className="card">
      <h3>{title} — {report.length} issue{report.length === 1 ? '' : 's'} detected</h3>
      {report.length === 0 && <p className="muted">No anomalies detected.</p>}
      {report.map((r, i) => (
        <div key={i} className="anomaly-item">
          <div className="anomaly-type">{r.type.replace(/_/g, ' ')}</div>
          <div>
            <strong>Row {r.rowNum}</strong> — {r.description}
          </div>
          <div>{r.detail}</div>
          <div className="anomaly-policy">Action taken: {r.policy}</div>
          <span className="anomaly-action">{ACTION_LABELS[r.action] || r.action}</span>
        </div>
      ))}
    </div>
  );
}
