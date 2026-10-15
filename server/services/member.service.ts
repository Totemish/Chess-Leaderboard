import { Prisma, type PrismaClient, type User } from '@prisma/client';
import type { AuthUser } from '../middleware/auth.middleware';
import { ForbiddenError } from '../lib/errors';
import { isInstituteEmail } from '../domain/institute';

/** Retries after losing a race on a unique index; one is almost always enough. */
const MAX_ATTEMPTS = 3;

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** "google:1234" -> "google". */
function providerOf(authId: string): string {
  const split = authId.indexOf(':');
  return split > 0 ? authId.slice(0, split) : 'unknown';
}

/**
 * Members and the ways they sign in.
 *
 * A member (User) is one person; each Google, GitHub or Discord account they
 * sign in with is an Identity. A sign-in seen for the first time joins the
 * member who already has its verified institute email, so every way in reaches
 * the same Chess.com link and role. Sign-ins without a verified institute
 * email are never merged into anyone.
 */
export class MemberService {
  constructor(
    private readonly db: PrismaClient,
    /** Bare and lower-case: "iitr.ac.in". */
    readonly instituteDomain: string
  ) {}

  /** The sign-in's institute address, if its provider has verified it. */
  verifiedInstituteEmail(user: AuthUser): string | null {
    return user.emailVerified && isInstituteEmail(user.email, this.instituteDomain) ? user.email! : null;
  }

  /** The member behind a sign-in, or null if it has never been seen. */
  async find(authId: string): Promise<User | null> {
    const identity = await this.db.identity.findUnique({ where: { authId }, include: { user: true } });
    return identity?.user ?? null;
  }

  /**
   * The member behind a sign-in, created or joined on first sight.
   *
   * First sight can race: two tabs at once, or the same person signing in with
   * Google and GitHub together. Instead of locking, this relies on the unique
   * indexes on Identity.authId and User.instituteEmail. Institute sign-ins meet
   * in single-statement upserts on them, so racers end up on the same rows; any
   * other race makes the loser hit a unique-constraint error, read again and
   * find the winner's rows.
   */
  async resolve(user: AuthUser): Promise<User> {
    for (let attempt = 1; ; attempt++) {
      try {
        const member = await this.find(user.id);
        return member ? await this.adoptInstituteEmail(member, user) : await this.firstSignIn(user);
      } catch (error) {
        if (attempt < MAX_ATTEMPTS && isUniqueViolation(error)) continue;
        throw error;
      }
    }
  }

  /** Joining the leaderboard needs a member whose institute email a provider has verified. */
  assertInstituteMember(member: User, user: AuthUser): void {
    if (member.instituteEmail) return;
    const domain = this.instituteDomain;
    if (!isInstituteEmail(user.email, domain)) {
      throw new ForbiddenError(`Only ${domain} email addresses can join the leaderboard.`);
    }
    if (!user.emailVerified) {
      throw new ForbiddenError(
        `Your sign-in provider hasn't confirmed ${user.email}. Sign out, then sign in again with the Google account for your ${domain} email.`
      );
    }
    // Verified, yet not this member's: an older account already holds the address.
    throw new ForbiddenError(`${user.email} belongs to another member account. Sign in the way you did before.`);
  }

  private async firstSignIn(user: AuthUser): Promise<User> {
    const instituteEmail = this.verifiedInstituteEmail(user);
    const identity = { authId: user.id, provider: providerOf(user.id), email: user.email ?? null };
    const details = { name: user.name ?? null, email: user.email ?? null, image: user.image ?? null };

    if (instituteEmail) {
      // Upserts keyed on one unique column run as INSERT … ON CONFLICT: the
      // member with this address is created once, or found if it exists.
      const member = await this.db.user.upsert({
        where: { instituteEmail },
        create: { ...details, instituteEmail },
        update: {},
      });
      await this.db.identity.upsert({
        where: { authId: user.id },
        create: { ...identity, userId: member.id },
        update: {},
      });
      return member;
    }
    // A nested write: the member and its first identity are created in one transaction.
    return this.db.user.create({ data: { ...details, identities: { create: identity } } });
  }

  /**
   * A member created before their address was verified (or before identities
   * existed) takes the verified institute email of a later sign-in, unless
   * another member already holds it.
   */
  private async adoptInstituteEmail(member: User, user: AuthUser): Promise<User> {
    const instituteEmail = this.verifiedInstituteEmail(user);
    if (!instituteEmail || member.instituteEmail) return member;
    const holder = await this.db.user.findUnique({ where: { instituteEmail }, select: { id: true } });
    if (holder) return member;
    return this.db.user.update({ where: { id: member.id }, data: { instituteEmail } });
  }
}
