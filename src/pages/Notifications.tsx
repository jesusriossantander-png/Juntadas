import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellOff, CheckCheck } from 'lucide-react';
import { useAction, useApp } from '../app/AppContext';
import { EmptyState, Page, Skeleton } from '../components/ui';
import { formatRelative } from '../lib/format';
import type { AppNotification } from '../lib/types';

export default function Notifications() {
  const { backend, user, setUnread } = useApp();
  const { run } = useAction();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const load = useCallback(() => backend.listNotifications().then((n) => { setItems(n); setUnread(n.filter((x) => !x.read_at).length); }).catch(() => setItems([])), [backend, setUnread]);
  useEffect(() => {
    load();
    if (!user) return;
    return backend.subscribeNotifications(user.id, load);
  }, [backend, user, load]);
  const unread = items?.filter((n) => !n.read_at) ?? [];
  return (
    <Page title="Notificaciones" back="/" actions={unread.length > 0 && <button className="icon-btn" aria-label="Marcar todas como leídas" onClick={() => run(() => backend.markNotificationsRead('all').then(load))}><CheckCheck /></button>}>
      {!items && <Skeleton h={64} n={5} />}
      {items?.length === 0 && <EmptyState icon={<BellOff />} title="Nada por acá" text="Te avisamos cuando alguien proponga una juntada, se confirme una fecha, te informen un pago o pase mucho tiempo sin juntarse." />}
      {items && items.length > 0 && (
        <div className="card flush list">
          {items.map((n) => (
            <Link key={n.id} to={n.link ?? '/'} className="list-item" onClick={() => !n.read_at && backend.markNotificationsRead([n.id]).then(load)} style={{ alignItems: 'flex-start' }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, flexShrink: 0, background: n.read_at ? 'transparent' : 'var(--ember)' }} aria-label={n.read_at ? undefined : 'Sin leer'} />
              <div className="grow">
                <div className={n.read_at ? '' : 'bold'}>{n.title}</div>
                {n.body && <div className="muted small">{n.body}</div>}
                <div className="faint xsmall">{formatRelative(n.created_at)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}
