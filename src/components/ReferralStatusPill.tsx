import React from 'react';
import { referralStatusDescriptor } from '../lib/referralStatus';

export function ReferralStatusPill({ status }: { status: string | null }) {
  const descriptor = referralStatusDescriptor(status);
  return (
    <span title={descriptor.description} className={`inline-flex items-center whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-bold ${descriptor.badgeClassName}`}>
      {descriptor.label}
    </span>
  );
}

