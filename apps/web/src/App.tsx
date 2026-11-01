import { useEffect, useState } from 'react';
import { HomePage } from './pages/Home';
import { LivePage } from './pages/Live';
import { BroadcastPage } from './pages/Broadcast';
import { AdminPage } from './pages/Admin';
import { PocLipSyncPage } from './pages/PocLipSync';

function routeFromHash(): string {
  const h = window.location.hash.split('?')[0];
  if (h === '#/live') return 'live';
  if (h === '#/broadcast') return 'broadcast';
  if (h === '#/admin') return 'admin';
  if (h === '#/poc-lipsync') return 'poc-lipsync';
  return 'home';
}

export default function App() {
  const [route, setRoute] = useState(routeFromHash());
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  if (route === 'live') return <LivePage />;
  if (route === 'broadcast') return <BroadcastPage />;
  if (route === 'admin') return <AdminPage />;
  if (route === 'poc-lipsync') return <PocLipSyncPage />;
  return <HomePage />;
}
