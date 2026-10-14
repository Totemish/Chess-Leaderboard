'use client';

import { SessionProvider } from 'next-auth/react';
import { MotionConfig } from 'framer-motion';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {/* Honour the visitor's "reduce motion" setting for every animation */}
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </SessionProvider>
  );
}
