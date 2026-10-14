import type { Metadata } from 'next';
import ProviderButtons from '@/components/auth/provider-buttons';

export const metadata: Metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  AccessDenied: 'Access was denied. Try another account or provider.',
  Configuration: 'Sign-in is misconfigured on the server. Ask a club admin to check the OAuth settings.',
};

/**
 * Reduces the callback to a path on this site (Auth.js sends absolute URLs),
 * so a crafted sign-in link can't redirect anywhere else afterwards.
 */
function safeCallback(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return '/dashboard';
  try {
    const { pathname, search } = new URL(raw, 'http://placeholder.invalid');
    return pathname.startsWith('//') ? '/dashboard' : pathname + search;
  } catch {
    return '/dashboard';
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  const error = errorCode ? (ERRORS[errorCode] ?? 'Sign-in didn’t finish. Try again, or use a different provider.') : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-12 pb-20 sm:pt-20">
      <div className="max-w-sm">
        <h1 className="text-4xl font-extrabold tracking-tight font-stretch-[118%]">Sign in</h1>
        <p className="mt-3 text-ink-soft">
          Link your Chess.com account, join club tournaments, and follow your rating over time.
        </p>

        {error && (
          <p role="alert" className="mt-6 rounded-md border border-loss/40 bg-surface px-4 py-3 text-sm text-ink">
            {error}
          </p>
        )}

        <ProviderButtons callbackUrl={safeCallback(params.callbackUrl)} />

        <p className="mt-8 border-t border-line pt-4 text-sm text-ink-faint">
          To appear on the leaderboard, sign in with the account that uses your <strong className="font-semibold text-ink-soft">@iitr.ac.in</strong> email.
        </p>
      </div>
    </div>
  );
}
