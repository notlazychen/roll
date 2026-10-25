import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import LoginPage from './pages/LoginPage'
import EntriesPage from './pages/EntriesPage'
import ChartsPage from './pages/ChartsPage'
import OptionsPage from './pages/OptionsPage'
import AccountPage from './pages/AccountPage'
import TodoTodayPage from './pages/TodoTodayPage'
import TodoPlanPage from './pages/TodoPlanPage'
import TodoChartsPage from './pages/TodoChartsPage'
import AppLayout from './components/AppLayout'

/** 未登录一律回登录页，并记住原本想去哪 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenLoading />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** 已登录就别再看登录页了 */
function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenLoading />
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}

function FullScreenLoading() {
  return (
    <div className="full-loading">
      <span className="spinner" />
      <p>正在加载…</p>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        }
      />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<EntriesPage />} />
        <Route path="/charts" element={<ChartsPage />} />
        <Route path="/options" element={<OptionsPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/todo" element={<TodoTodayPage />} />
        <Route path="/todo/plan" element={<TodoPlanPage />} />
        <Route path="/todo/charts" element={<TodoChartsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
