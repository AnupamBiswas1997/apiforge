/**
 * App.jsx
 *
 * What this file does:
 *   Root React component. Sets up React Router routes and wraps the app
 *   in all global context providers (LLMContext, ToastProvider).
 *
 * Responsible for:
 *   - Defining all client-side routes
 *   - Providing global context to all child components
 *
 * NOT responsible for:
 *   - Any page-level rendering (delegated to page components)
 *   - API calls or data fetching
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LLMProvider } from './context/LLMContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';

import Connect from './pages/Connect';
import Upload from './pages/Upload';
import RunProgress from './pages/RunProgress';
import Report from './pages/Report';
import History from './pages/History';

/**
 * @description Root application component. Wraps all pages in providers
 * and sets up client-side routing via React Router v6.
 * @returns {JSX.Element}
 */
export default function App() {
  return (
    // ThemeProvider must be outermost — applies theme class to <html>
    <ThemeProvider>
    {/* ToastProvider must be accessible everywhere */}
    <ToastProvider>
      {/* LLMProvider manages the active LLM provider state globally */}
      <LLMProvider>
        <BrowserRouter>
          {/* Top-level ErrorBoundary catches unhandled render errors */}
          <ErrorBoundary>
            <Routes>
              {/* LLM provider setup page — first stop for new users */}
              <Route path="/connect" element={<Connect />} />

              {/* Requirements upload + configuration */}
              <Route path="/" element={<Upload />} />

              {/* Live pipeline execution view */}
              <Route path="/run/:runId" element={<RunProgress />} />

              {/* Report dashboard for a completed run */}
              <Route path="/report/:runId" element={<Report />} />

              {/* Run history table */}
              <Route path="/history" element={<History />} />

              {/* Catch-all: redirect unknown paths to home */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </BrowserRouter>
      </LLMProvider>
    </ToastProvider>
    </ThemeProvider>
  );
}
