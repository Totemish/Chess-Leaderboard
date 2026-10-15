/**
 * Whether an email address belongs to the institute: the domain itself or any
 * subdomain of it. IIT Roorkee addresses come in both shapes, name@iitr.ac.in
 * and department ones such as name@ece.iitr.ac.in.
 *
 * Matches whole DNS labels, so look-alikes such as name@notiitr.ac.in or
 * name@iitr.ac.in.example.com don't count. `domain` is bare and lower-case
 * ("iitr.ac.in").
 */
export function isInstituteEmail(email: string | null | undefined, domain: string): boolean {
  if (!email) return false;
  // The domain follows the last "@": a quoted local part may itself contain one.
  const at = email.lastIndexOf('@');
  if (at <= 0) return false;
  const host = email.slice(at + 1).toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}
