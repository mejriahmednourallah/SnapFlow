import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/hooks/useTheme";
import { AuthProvider } from "@/hooks/useAuth";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

// New layout
import AppLayout from "./components/layout/AppLayout";
import Overview from "./pages/Overview";
import AdminProjects from "./pages/AdminProjects";
import AdminUsers from "./pages/AdminUsers";
import ReportSchedules from "./pages/ReportSchedules";
import ReportsPage from "./pages/ReportsPage";
import NotificationsPage from "./pages/NotificationsPage";
import AssistantPage from "./pages/AssistantPage";
import WorkflowsPage from "./pages/WorkflowsPage";
import FormTesterPage from "./pages/FormTesterPage";
import FormTesterBuilderPage from "./pages/FormTesterBuilderPage";
import FormTesterResultsPage from "./pages/FormTesterResultsPage";
import ProjectDetail from "./pages/ProjectDetail";
import ActivityReport from "./pages/ActivityReport";
import AuditReport from "./pages/AuditReport";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Navigate to="/auth" replace />} />
              <Route path="/auth" element={<Auth />} />

              {/* New unified layout */}
              <Route path="/app" element={<AppLayout />}>
                <Route index element={<Overview />} />
                <Route path="projects" element={<AdminProjects />} />
                <Route path="projects/:id" element={<ProjectDetail />} />
                <Route path="projects/:id/activity" element={<ActivityReport />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="schedules" element={<ReportSchedules />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="assistant" element={<AssistantPage />} />
                <Route path="workflows" element={<WorkflowsPage />} />
                <Route path="workflows/form-tester" element={<FormTesterPage />} />
                <Route path="workflows/form-tester/:id" element={<FormTesterBuilderPage />} />
                <Route path="workflows/form-tester/:id/results" element={<FormTesterResultsPage />} />
                <Route path="users" element={<AdminUsers />} />
              </Route>

              {/* Legacy routes - redirect to new paths */}
              <Route path="/dashboard" element={<Navigate to="/app" replace />} />
              <Route path="/admin" element={<Navigate to="/app" replace />} />
              <Route path="/admin/projects" element={<Navigate to="/app/projects" replace />} />
              <Route path="/admin/users" element={<Navigate to="/app/users" replace />} />
              <Route path="/admin/schedules" element={<Navigate to="/app/schedules" replace />} />
              <Route path="/admin/projects/:id" element={<Navigate to="/app/projects/:id" replace />} />
              <Route path="/schedules" element={<Navigate to="/app/schedules" replace />} />

              <Route path="/audit/:id" element={<AuditReport />} />
              <Route path="/audit/:id/view" element={<AuditReport />} />

              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
