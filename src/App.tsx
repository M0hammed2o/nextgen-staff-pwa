import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { BrandProvider } from "@/lib/brand-provider";
import { BrandSync } from "@/components/BrandSync";
import { TouchKeyboardProvider } from "@/lib/touch-keyboard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import ProtectedRoute from "@/components/ProtectedRoute";
import BottomNav from "@/components/BottomNav";
import TouchKeyboard from "@/components/TouchKeyboard";
import { Toaster } from "@/components/ui/toaster";
import Login from "@/pages/Login";
import Welcome from "@/pages/Welcome";
import LiveOrders from "@/pages/LiveOrders";
import Pos from "@/pages/Pos";
import OrderDetail from "@/pages/OrderDetail";
import CompletedOrders from "@/pages/CompletedOrders";
import Wastage from "@/pages/Wastage";
import Stocktake from "@/pages/Stocktake";
import Profile from "@/pages/Profile";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10000,
    },
  },
});

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      {/* BrandProvider sits INSIDE AuthProvider (it reads the saved business)
          but OUTSIDE the router, so the restaurant's colours are already on
          <html> before the first route renders -- including /login, which is
          the PIN screen a cashier sees at the start of every shift. */}
      <BrandProvider>
      <BrandSync />
      <BrowserRouter>
      <TouchKeyboardProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/welcome"
            element={
              <ProtectedRoute>
                <Welcome />
              </ProtectedRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <LiveOrders />
              </ProtectedRoute>
            }
          />
          <Route
            path="/pos"
            element={
              <ProtectedRoute>
                <Pos />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders/:orderId"
            element={
              <ProtectedRoute>
                <OrderDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/wastage"
            element={
              <ProtectedRoute>
                <Wastage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stocktake"
            element={
              <ProtectedRoute>
                <Stocktake />
              </ProtectedRoute>
            }
          />
          <Route
            path="/completed"
            element={
              <ProtectedRoute>
                <CompletedOrders />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <BottomNav />
        <TouchKeyboard />
        <Toaster />
      </TouchKeyboardProvider>
      </BrowserRouter>
      </BrandProvider>
    </AuthProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
