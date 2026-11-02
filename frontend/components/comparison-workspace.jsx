'use client';

import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ComparisonView } from '@/components/comparison-view';
import { HousingChat } from '@/components/housing-chat';
import { useState } from 'react';

export function ComparisonWorkspace({ onClose, backLabel = 'Back to search', ...props }) {
  const [focus, setFocus] = useState('all');
  return <div className="comparison-workspace">
    <header className="comparison-workspace-header"><div><Button variant="ghost" onClick={onClose}><ArrowLeft size={17} aria-hidden="true" />{backLabel}</Button><h1>Compare selected homes</h1></div><p>{props.homes.length} historical records · your priorities, side by side</p></header>
    <section className="comparison-workspace-content" aria-label="Comparison evidence"><ComparisonView {...props} assistantMode="external" focus={focus} onFocusChange={setFocus} /></section>
    <HousingChat context="comparison" focus={focus} user={props.user} homes={props.homes} brief={props.brief} workspaceReady={props.workspaceReady} />
  </div>;
}
