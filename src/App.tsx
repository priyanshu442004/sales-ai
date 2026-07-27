import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { LeadSearch } from './pages/LeadSearch';
import { Jobs } from './pages/Jobs';
import { AllLeads } from './pages/AllLeads';
import { Leads } from './pages/Leads';
import { OutreachStudio } from './pages/OutreachStudio';
import { ApprovalQueue } from './pages/ApprovalQueue';
import { Sequences } from './pages/Sequences';
import { Campaigns } from './pages/Campaigns';
import { Inbox } from './pages/Inbox';
import { Templates } from './pages/Templates';
import { Analytics } from './pages/Analytics';
import { Integrations } from './pages/Integrations';
import { Team } from './pages/Team';
import { Settings } from './pages/Settings';
import { AuditLogPage } from './pages/AuditLog';
import { useUiStore } from './store/useUiStore';

// Protected Route component to shield pages
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useUiStore();
  
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Auth Route */}
        <Route path="/login" element={<Login />} />

        {/* Secure Pages Dashboard Container */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          {/* Main sections */}
          <Route index element={<Dashboard />} />
          <Route path="search" element={<LeadSearch />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="leads/all" element={<AllLeads />} />
          <Route path="leads" element={<Leads />} />
          
          {/* Outreach sub sections */}
          <Route path="outreach/studio" element={<OutreachStudio />} />
          <Route path="outreach/approval" element={<ApprovalQueue />} />
          <Route path="outreach/sequences" element={<Sequences />} />
          <Route path="outreach/campaigns" element={<Campaigns />} />
          
          {/* Auxiliary sections */}
          <Route path="inbox" element={<Inbox />} />
          <Route path="templates" element={<Templates />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="team" element={<Team />} />
          <Route path="settings" element={<Settings />} />
          <Route path="audit-log" element={<AuditLogPage />} />
        </Route>

        {/* Fallback redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
