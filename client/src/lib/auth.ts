import NextAuth, { type Account, type Profile } from 'next-auth';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import Discord from 'next-auth/providers/discord';

/**
 * Whether the provider vouches that the user owns their email address. The
 * API only lets verified IIT Roorkee addresses (@iitr.ac.in or a department
 * subdomain such as @ece.iitr.ac.in) join the leaderboard.
 * - Google: the `email_verified` claim
 * - Discord: the `verified` flag on the user
 * - GitHub: the `verified` flag on that address in /user/emails
 */
async function isEmailVerified(account: Account, profile: Profile | undefined, email: string | null | undefined) {
  if (account.provider === 'google') return profile?.email_verified === true;
  if (account.provider === 'discord') return profile?.verified === true;
  if (account.provider === 'github' && email && account.access_token) {
    try {
      const response = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${account.access_token}`, 'User-Agent': 'iitr-chess-leaderboard' },
      });
      if (!response.ok) return false;
      const emails = (await response.json()) as { email: string; verified: boolean }[];
      return emails.some((e) => e.email.toLowerCase() === email.toLowerCase() && e.verified);
    } catch {
      return false;
    }
  }
  return false;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      checks: ['state'],
      authorization: {
        params: {
          prompt: 'select_account',
        },
      },
    }),
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
      checks: ['state'],
    }),
    Discord({
      clientId: process.env.AUTH_DISCORD_ID!,
      clientSecret: process.env.AUTH_DISCORD_SECRET!,
      checks: ['state'],
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  cookies: {
    state: {
      name: 'next-auth.state-local',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
    pkceCodeVerifier: {
      name: 'next-auth.pkce-local',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        // Without a database adapter, Auth.js gives every sign-in a fresh random
        // user id (token.sub). The Express API stores that id as Identity.authId, so a
        // random one would orphan the user's linked Chess.com profile and admin
        // role each time they sign in again. Key users on the provider account,
        // which never changes.
        token.sub = `${account.provider}:${account.providerAccountId}`;
        token.provider = account.provider;
        token.providerAccountId = account.providerAccountId;
        token.emailVerified = await isEmailVerified(account, profile, token.email);
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      session.emailVerified = token.emailVerified === true;
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
  trustHost: true,
});
