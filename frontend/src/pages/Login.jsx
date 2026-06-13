import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken, setCurrentUser } from '../api';

export default function Login() {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const fn = mode === 'login' ? api.login : api.register;
      const body = mode === 'login' ? { email, password } : { name, email, password };
      const data = await fn(body);
      setToken(data.token);
      setCurrentUser(data.user);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 400, margin: '40px auto' }}>
      <div className="tabs">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
          Log in
        </button>
        <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
          Register
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <form onSubmit={submit}>
        {mode === 'register' && (
          <div className="form-row">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        )}
        <div className="form-row">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="form-row">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="btn" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Please wait...' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>

      <p className="muted" style={{ marginTop: 16 }}>
        Demo accounts (seeded): aisha@example.com, rohan@example.com, priya@example.com,
        meera@example.com, dev@example.com, sam@example.com — password: <code>password123</code>
      </p>
    </div>
  );
}
