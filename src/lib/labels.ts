// Enum values never reach the screen raw: every one goes through its label map.

import type { Role } from './server/actor';

export const ROLE_LABELS: Record<Role, string> = {
	ADMIN: 'Administrador',
	MANAGER: 'Gerente',
	SALES: 'Ventas',
	WAREHOUSE: 'Bodega',
	DRIVER: 'Conductor'
};
