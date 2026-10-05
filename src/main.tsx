import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InvestorsRoute } from './investors/InvestorsRoute';

export { ErrorBoundary };

const rootEl = document.getElementById('root');
if (rootEl) {
  try {
    const root = createRoot(rootEl);
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <InvestorsRoute>
            <App />
          </InvestorsRoute>
        </ErrorBoundary>
      </StrictMode>
    );
    (window as any).__NEXORA_MOUNTED__ = true;
  } catch (err: any) {
    console.error('[Nexora Main] Fatal error mounting application:', err);
    rootEl.innerHTML = `
      <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background-color: #f8fafc; padding: 24px; font-family: system-ui, -apple-system, sans-serif; color: #1e293b;">
        <div style="max-width: 480px; width: 100%; background: #ffffff; border-radius: 20px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0; padding: 32px; text-align: center;">
          <div style="width: 48px; height: 48px; background-color: #fef2f2; color: #dc2626; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-weight: 800; font-size: 20px;">!</div>
          <h2 style="font-size: 18px; font-weight: 800; color: #0f172a; margin: 0 0 8px;">Initialization Notice</h2>
          <p style="font-size: 13px; color: #64748b; margin: 0 0 20px; line-height: 1.5;">${(err && err.message) || 'The application encountered an issue while loading components.'}</p>
          <div style="display: flex; gap: 10px;">
            <button onclick="try { localStorage.clear(); sessionStorage.clear(); } catch(e){} window.location.href = '/';" style="flex: 1; padding: 12px; background: #059669; color: white; border: none; border-radius: 12px; font-weight: 700; font-size: 13px; cursor: pointer;">Reset & Launch</button>
            <button onclick="window.location.reload();" style="flex: 1; padding: 12px; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; border-radius: 12px; font-weight: 700; font-size: 13px; cursor: pointer;">Reload Page</button>
          </div>
        </div>
      </div>
    `;
  }
}
