import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { getCurrentUser, setCurrentUser, setToken } from './api';
import Login from './pages/Login';
import GroupsList from './pages/GroupsList';
import GroupDetail from './pages/GroupDetail';

function Protected({ children }) {
  const user = getCurrentUser();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function TopBar() {
  const [user, setUser] = useState(getCurrentUser());
  const navigate = useNavigate();

  function logout() {
    setToken(null);
    setCurrentUser(null);
    setUser(null);
    navigate('/login');
  }

  return (
    <div className="topbar">
      <h1>
        <Link to="/">Flat 4B — Shared Expenses</Link>
      </h1>
      {user && (
        <div className="user-info">
          {user.name} ({user.email}){' '}
          <button className="btn secondary" style={{ marginLeft: 8 }} onClick={logout}>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <TopBar />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <Protected>
                <GroupsList />
              </Protected>
            }
          />
          <Route
            path="/groups/:id"
            element={
              <Protected>
                <GroupDetail />
              </Protected>
            }
          />
        </Routes>
      </div>
    </HashRouter>
  );
}
