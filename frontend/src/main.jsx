import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { translateText } from './language.js';
import SplashScreen from './components/SplashScreen.jsx';
import './styles.css';
import './homepage.css';

const nativeConfirm = window.confirm.bind(window);
window.confirm = (message) => nativeConfirm(translateText(String(message)));

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <React.Suspense fallback={<SplashScreen label="Loading page…" />}>
      <App />
    </React.Suspense>
  </React.StrictMode>,
);
