import { createRoot } from 'react-dom/client';
import App from './App';
import './App.css';
import './jfire-drawer.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('JFIRE: root element #root was not found');
}

createRoot(root).render(<App />);
