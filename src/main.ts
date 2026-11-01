import './style.css';
import { App } from './ui/app';

/** Drop private drafts before a BFCache snapshot; restore a fresh title on return. */
export function mountApp(root: HTMLElement): () => void {
  let app: App | undefined = new App(root);
  const hide = (): void => { app?.dispose(); app = undefined; };
  const show = (event: PageTransitionEvent): void => {
    if (event.persisted && !app) app = new App(root);
  };
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', show);
  return () => {
    window.removeEventListener('pagehide', hide);
    window.removeEventListener('pageshow', show);
    hide();
  };
}

const root = document.querySelector<HTMLElement>('#app');
if (root) mountApp(root);
