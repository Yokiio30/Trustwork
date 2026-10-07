import { Link, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { Empty, RequireRole } from "./components/ui";
import Marketplace from "./pages/Marketplace";
import JobDetail from "./pages/JobDetail";
import CreateJob from "./pages/CreateJob";
import MyWork from "./pages/MyWork";
import Disputes from "./pages/Disputes";
import DisputeDetail from "./pages/DisputeDetail";
import Dashboard from "./pages/Dashboard";
import Audit from "./pages/Audit";
import Admin from "./pages/Admin";
import Profile from "./pages/Profile";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Marketplace />} />
        <Route path="jobs/new" element={<CreateJob />} />
        <Route path="jobs/:id" element={<JobDetail />} />
        <Route path="my-work" element={<MyWork />} />
        <Route path="disputes" element={<Disputes />} />
        <Route path="disputes/:id" element={<DisputeDetail />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route
          path="audit"
          element={
            <RequireRole roles={["auditor", "admin"]}>
              <Audit />
            </RequireRole>
          }
        />
        <Route
          path="admin"
          element={
            <RequireRole roles={["admin"]}>
              <Admin />
            </RequireRole>
          }
        />
        <Route path="profile/:address" element={<Profile />} />
        <Route
          path="*"
          element={
            <Empty title="Page not found">
              <Link to="/" className="text-brand-600 underline">
                Back to the marketplace
              </Link>
            </Empty>
          }
        />
      </Route>
    </Routes>
  );
}
