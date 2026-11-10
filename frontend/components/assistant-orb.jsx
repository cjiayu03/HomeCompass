'use client';

import { useEffect, useState } from 'react';

export function AssistantOrb({ active = false }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const sync = () => setVisible(!document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return <span aria-hidden="true" className={`assistant-orb${active ? ' assistant-orb--active' : ''}${visible ? '' : ' assistant-orb--paused'}`}><span className="assistant-orb-flow" /><span className="assistant-orb-plasma" /><span className="assistant-orb-light" /></span>;
}
