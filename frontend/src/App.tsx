import AppRouter from "./router";
import { AuthProvider } from "./context/AuthContext";
import { Toaster } from "react-hot-toast";
import UpgradeModal from "./components/UpgradeModal";

function App() {
  return (
    <AuthProvider>
      <AppRouter />
      <UpgradeModal />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#1e293b',
            color: '#fff',
            border: '1px solid #475569',
          },
          success: {
            iconTheme: {
              primary: '#06b6d4',
              secondary: '#fff',
            },
          },
          error: {
            iconTheme: {
              primary: '#ef4444',
              secondary: '#fff',
            },
          },
        }}
      />
    </AuthProvider>
  );
}

export default App;
