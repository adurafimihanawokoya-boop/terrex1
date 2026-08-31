import App from "./App";
import AdminDashboard from "./AdminDashboard";

/* Simple path-based switch — no router library needed for two screens.
   Any URL starting with /admin (e.g. /admin, /admin/) shows the
   dashboard; everything else shows the regular app. */
export default function Root() {
  const isAdmin = window.location.pathname.startsWith("/admin");
  return isAdmin ? <AdminDashboard /> : <App />;
}
