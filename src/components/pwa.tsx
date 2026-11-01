import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

/** Instalación en Android/Chrome/Edge (en iPhone se instala desde "Compartir → Agregar a inicio"). */
export function useInstallPrompt() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return {
    canInstall: !!deferred,
    install: async () => {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      listeners.forEach((l) => l());
      return outcome === 'accepted';
    }
  };
}

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

/** Aviso de nueva versión: la actualización se aplica solo si la persona acepta (no se pierde nada a medio cargar). */
export function UpdatePrompt() {
  const [need, setNeed] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    updateSW = registerSW({
      onNeedRefresh: () => setNeed(true),
      onRegisteredSW: (_url, reg) => {
        if (reg) setInterval(() => reg.update().catch(() => undefined), 60 * 60 * 1000);
      }
    });
  }, []);
  if (!need) return null;
  return (
    <div className="toasts" style={{ bottom: 'calc(var(--nav-h) + var(--safe-b) + 70px)' }}>
      <div className="toast" style={{ gap: 12 }}>
        <RefreshCw />
        <span>Hay una versión nueva de La Juntada</span>
        <button className="btn btn-sm btn-primary" onClick={() => updateSW?.(true)}>Actualizar</button>
      </div>
    </div>
  );
}
