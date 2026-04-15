import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Chronicle from "@/pages/chronicle";
import Mint from "@/pages/mint";
import AuthVerify from "@/pages/auth-verify";
import AppNav from "@/components/app-nav";
import { usePageTracker } from "@/components/page-tracker";

function AppRouter() {
  usePageTracker();
  return (
    <>
      <AppNav />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/chronicle" component={Chronicle} />
        <Route path="/mint" component={Mint} />
        <Route path="/auth/verify/:token" component={AuthVerify} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider>
            <Toaster />
            <Router hook={useHashLocation}>
              <AppRouter />
            </Router>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
