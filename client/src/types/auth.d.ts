import '@auth/core/types';

declare module '@auth/core/types' {
  interface Session {
    /** Whether the sign-in provider vouched for the email address. */
    emailVerified?: boolean;
  }
}
