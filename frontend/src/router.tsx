import { BrowserRouter, Routes, Route } from "react-router-dom";
import Tools from "./pages/Tools";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ProtectedRoute from "./components/ProtectedRoute";
import Scanner from "./pages/Scanner";
import Nikto from "./pages/Nikto";
import WebCrawler from "./pages/WebCrawler";
import TrafficAnalyzer from "./pages/TrafficAnalyzer";
import VulnScanner from "./pages/VulnScanner";
import SubdomainEnum from "./pages/SubdomainEnum";
import DirEnum from "./pages/DirEnum";
import Landing from "./pages/Landing";
import FFUF from "./pages/FFUF";
import SQLMap from "./pages/SQLMap";
import Nuclei from "./pages/Nuclei";
import Profile from "./pages/Profile";
import Chat from "./pages/Chat";
import History from "./pages/History";
import SOC from "./pages/SOC";

// Phase 2 — SOC platform extension pages (incidents, cases, alert triage).
// New routes are additive; existing routes remain untouched.

// Phase 3 — Threat Hunting, IOC Intelligence.

// Phase 4 — SOAR control, Asset inventory, Executive dashboard.
import SoarControlCenter from "./pages/SoarControlCenter";

// Phase 5 — Live Monitor (realtime feed) + AI Security Assistant.
import AIAssistant from "./pages/AIAssistant";

// Cross-platform integration — TheHive (read-only mirror).

// SaaS — per-tenant settings (provisioning, enrollment key, plan).
import SettingsOrganization from "./pages/SettingsOrganization";
import SettingsAgents from "./pages/SettingsAgents";

export default function AppRouter() {
    return (
        <BrowserRouter>
            <Routes>
                {/* Public Routes */}
                <Route path="/" element={<Dashboard />} />
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />

                {/* Operations - Redirect old routes to tools */}
                <Route path="/pentest" element={<ProtectedRoute><Tools /></ProtectedRoute>} />
                <Route path="/blue" element={<ProtectedRoute><Tools /></ProtectedRoute>} />

                {/* All Tools */}
                <Route path="/tools" element={<ProtectedRoute><Tools /></ProtectedRoute>} />
                <Route path="/tools/:categorySlug" element={<ProtectedRoute><Tools /></ProtectedRoute>} />

                {/* Dedicated Dashboard Route (Optional, points to home) */}
                <Route path="/dashboard" element={<Dashboard />} />

                {/* Specific Tools */}
                <Route path="/tools/nmap-scanner" element={<ProtectedRoute><Scanner /></ProtectedRoute>} />
                <Route path="/tools/nikto" element={<ProtectedRoute><Nikto /></ProtectedRoute>} />
                <Route path="/tools/web-crawler" element={<ProtectedRoute><WebCrawler /></ProtectedRoute>} />
                <Route path="/tools/analyzer" element={<ProtectedRoute><TrafficAnalyzer /></ProtectedRoute>} />
                <Route path="/tools/vuln-scanner" element={<ProtectedRoute><VulnScanner /></ProtectedRoute>} />
                <Route path="/tools/subdomain-enum" element={<ProtectedRoute><SubdomainEnum /></ProtectedRoute>} />
                <Route path="/tools/dir-enum" element={<ProtectedRoute><DirEnum /></ProtectedRoute>} />
                <Route path="/tools/ffuf" element={<ProtectedRoute><FFUF /></ProtectedRoute>} />
                <Route path="/tools/sqlmap" element={<ProtectedRoute><SQLMap /></ProtectedRoute>} />
                <Route path="/tools/nuclei" element={<ProtectedRoute><Nuclei /></ProtectedRoute>} />
                <Route path="/tools/openvas" element={<ProtectedRoute><Nuclei /></ProtectedRoute>} />

                {/* Reports & History */}
                <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
                <Route path="/reports" element={<ProtectedRoute><History /></ProtectedRoute>} />

                {/* Security Operations Center — Wazuh SIEM + XDR */}
                <Route path="/soc"      element={<ProtectedRoute><SOC mode="siem" /></ProtectedRoute>} />
                <Route path="/soc/siem" element={<ProtectedRoute><SOC mode="siem" /></ProtectedRoute>} />
                <Route path="/soc/xdr"  element={<ProtectedRoute><SOC mode="xdr"  /></ProtectedRoute>} />
                <Route path="/soc/ti"   element={<ProtectedRoute><SOC mode="ti"   /></ProtectedRoute>} />
                <Route path="/ti"       element={<ProtectedRoute><SOC mode="ti"   /></ProtectedRoute>} />
                <Route path="/siem"     element={<ProtectedRoute><SOC mode="siem" /></ProtectedRoute>} />
                <Route path="/xdr"      element={<ProtectedRoute><SOC mode="xdr"  /></ProtectedRoute>} />
                <Route path="/edr"      element={<ProtectedRoute><SOC mode="xdr"  /></ProtectedRoute>} />

                {/* Phase 4 — SOAR · Assets · Executive
                    Note: the legacy `/soar` route (aliased to the Wazuh SOC page) is left untouched
                    to preserve backward compatibility. The new SOAR Control Center lives at
                    `/soc/soar` and `/soar-center`. */}
                <Route path="/soc/soar"           element={<ProtectedRoute><SoarControlCenter /></ProtectedRoute>} />
                <Route path="/soar-center"        element={<ProtectedRoute><SoarControlCenter /></ProtectedRoute>} />
                {/* Phase 5 — Live Monitor (realtime stream) · AI Security Assistant */}
                <Route path="/ai"                 element={<ProtectedRoute><AIAssistant /></ProtectedRoute>} />
                <Route path="/soc/ai"             element={<ProtectedRoute><AIAssistant /></ProtectedRoute>} />

                {/* Cross-platform — TheHive (read-only mirror) */}

                {/* System & Identity */}
                <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
                <Route path="/settings/organization" element={<ProtectedRoute><SettingsOrganization /></ProtectedRoute>} />
                <Route path="/settings/agents" element={<ProtectedRoute><SettingsAgents /></ProtectedRoute>} />
                <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />

                {/* Default route */}
                <Route path="*" element={<Dashboard />} />
            </Routes>
        </BrowserRouter>
    );
}