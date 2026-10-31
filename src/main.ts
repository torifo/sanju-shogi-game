import './style.css';
import { App } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (root) {
  const app = new App(root);
  window.addEventListener('pagehide', () => app.dispose(), { once: true });
}
