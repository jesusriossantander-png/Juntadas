import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { CalendarDays, Home, Plus, Users, UserRound } from 'lucide-react';
import { AppProvider, useApp } from './app/AppContext';
import { Skeleton, Toasts } from './components/ui';
import { UpdatePrompt } from './components/pwa';
import { AuthPage, NewPasswordPage } from './pages/Auth';
import Dashboard from './pages/Dashboard';

const Groups = lazy(() => import('./pages/Groups'));
const GroupDetail = lazy(() => import('./pages/GroupDetail'));
const JoinGroup = lazy(() => import('./pages/JoinGroup'));
const Gatherings = lazy(() => import('./pages/Gatherings'));
const NewGathering = lazy(() => import('./pages/NewGathering'));
const GatheringDetail = lazy(() => import('./pages/GatheringDetail'));
const ExpenseForm = lazy(() => import('./pages/ExpenseForm'));
const Settle = lazy(() => import('./pages/Settle'));
const Stats = lazy(() => import('./pages/Stats'));
const Polls = lazy(() => import('./pages/Polls'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Settings = lazy(() => import('./pages/Settings'));
const Help = lazy(() => import('./pages/Help'));

function BottomNav() {
  const { pathname } = useLocation();
  const hide = /\/gastos\/|\/nueva|\/unirse/.test(pathname);
  if (hide) return null;
  return (
    <nav className="bottomnav" aria-label="Navegación principal">
      <div className="bottomnav-inner">
        <NavLink to="/" end className="navlink"><Home /><span>Inicio</span></NavLink>
        <NavLink to="/juntadas" className="navlink"><CalendarDays /><span>Juntadas</span></NavLink>
        <NavLink to="/juntadas/nueva" className="nav-fab" aria-label="Nueva juntada"><Plus size={28} /></NavLink>
        <NavLink to="/grupos" className="navlink"><Users /><span>Grupos</span></NavLink>
        <NavLink to="/ajustes" className="navlink"><UserRound /><span>Perfil</span></NavLink>
      </div>
    </nav>
  );
}

function Banners() {
  const { backend, online } = useApp();
  return (
    <>
      {backend.mode === 'demo' && (
        <div className="demo-banner" role="note">MODO DEMO · datos ficticios guardados solo en este dispositivo</div>
      )}
      {!online && <div className="offline-banner" role="status">Sin conexión: ves los últimos datos guardados. Para cargar cambios necesitás internet.</div>}
    </>
  );
}

/** Si alguien abre un enlace de invitación sin sesión, lo recordamos para después del login. */
function PendingInvite() {
  const { user } = useApp();
  const nav = useNavigate();
  useEffect(() => {
    const code = sessionStorage.getItem('la-juntada:pending-invite');
    if (user && code) {
      sessionStorage.removeItem('la-juntada:pending-invite');
      nav(`/unirse/${code}`);
    }
  }, [user, nav]);
  return null;
}

function Routed() {
  const { user, ready, recoveryMode } = useApp();
  const { pathname } = useLocation();
  if (!ready) return <div className="main"><Skeleton h={120} n={3} /></div>;
  if (recoveryMode || pathname === '/nueva-clave') return user ? <NewPasswordPage /> : <AuthPage />;
  if (!user) {
    const m = pathname.match(/^\/unirse\/([A-Za-z0-9]+)/);
    if (m) sessionStorage.setItem('la-juntada:pending-invite', m[1]);
    return <AuthPage />;
  }
  return (
    <>
      <PendingInvite />
      <Suspense fallback={<div className="main"><Skeleton h={120} n={3} /></div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/grupos" element={<Groups />} />
          <Route path="/grupos/:groupId" element={<GroupDetail />} />
          <Route path="/unirse/:code" element={<JoinGroup />} />
          <Route path="/unirse" element={<JoinGroup />} />
          <Route path="/juntadas" element={<Gatherings />} />
          <Route path="/historial" element={<Gatherings initialTab="history" />} />
          <Route path="/juntadas/nueva" element={<NewGathering />} />
          <Route path="/juntadas/:id" element={<GatheringDetail />} />
          <Route path="/juntadas/:id/:tab" element={<GatheringDetail />} />
          <Route path="/juntadas/:id/gastos/nuevo" element={<ExpenseForm />} />
          <Route path="/juntadas/:id/gastos/:expenseId" element={<ExpenseForm />} />
          <Route path="/juntadas/:id/pagar" element={<Settle />} />
          <Route path="/estadisticas" element={<Stats />} />
          <Route path="/votaciones" element={<Polls />} />
          <Route path="/notificaciones" element={<Notifications />} />
          <Route path="/ajustes" element={<Settings />} />
          <Route path="/ayuda" element={<Help />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <BottomNav />
    </>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppProvider>
        <div className="app">
          <Banners />
          <Routed />
          <Toasts />
          <UpdatePrompt />
        </div>
      </AppProvider>
    </HashRouter>
  );
}
