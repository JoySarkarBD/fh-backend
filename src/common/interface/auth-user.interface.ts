/**
 * @fileoverview Shape of the authenticated user attached to the request.
 *
 * After a successful JWT validation the `JwtStrategy` fetches the
 * full user record and places it on `request.user`. This interface
 * describes the public (non-sensitive) fields available from there.
 */

export interface AuthUser {
  userId: string;
  email: string;
  role: string
}
