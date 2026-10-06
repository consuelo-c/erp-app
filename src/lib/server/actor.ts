import { error } from '@sveltejs/kit';
import { z } from 'zod';

export const ROLES = ['ADMIN', 'MANAGER', 'SALES', 'WAREHOUSE', 'DRIVER'] as const;

export type Role = (typeof ROLES)[number];

/** Who performs a write: a logged-in user, the seed, an AI agent or an external integration. */
export type Actor = {
	username: string;
	// Runtime only, for resource ownership: never written to events.
	employeeId: number | null;
	roles: Role[];
	kind: 'user' | 'system' | 'agent' | 'integration';
};

/** A login's `roles` column: non-empty, no duplicates, only real roles (clients have no login). */
export const rolesSchema = z
	.array(z.enum(ROLES))
	.nonempty()
	.refine((roles) => new Set(roles).size === roles.length, 'Roles must not repeat');

export function hasRole(actor: Actor, role: Role): boolean {
	return actor.roles.includes(role);
}

export function hasAnyRole(actor: Actor, roles: Role[]): boolean {
	return roles.some((role) => hasRole(actor, role));
}

/** Managing logins: creating them, assigning roles, reassigning them, setting passwords. */
export function isAdmin(actor: Actor): boolean {
	return hasRole(actor, 'ADMIN');
}

/** Everything else in the admin dashboard. */
export function isAdminOrManager(actor: Actor): boolean {
	return hasAnyRole(actor, ['ADMIN', 'MANAGER']);
}

/** Throws a 403 unless the actor holds at least one of `roles`. */
export function requireRole(actor: Actor, roles: Role[]): void {
	if (!hasAnyRole(actor, roles)) {
		error(403, 'No tiene permiso para esta acción');
	}
}
