import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { translateText } from './language.js';
import './styles.css';

const nativeConfirm = window.confirm.bind(window);
window.confirm = (message) => nativeConfirm(translateText(String(message)));

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
