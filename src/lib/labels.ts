// Enum values never reach the screen raw: every one goes through its label map.

import type { Role } from './server/actor';

export const ROLE_LABELS: Record<Role, string> = {
	ADMIN: 'Administrador',
	MANAGER: 'Gerente',
	SALES: 'Ventas',
	WAREHOUSE: 'Bodega',
	DRIVER: 'Conductor'
};

export const ORDER_STATUS_LABELS = {
	DRAFT: 'Borrador',
	CONFIRMED: 'Confirmado',
	PICKED: 'Separado',
	OUT_FOR_DELIVERY: 'En ruta de entrega',
	DELIVERED: 'Entregado',
	OUT_FOR_PICKUP: 'En ruta de recogida',
	COMPLETED: 'Completado',
	CANCELLED: 'Cancelado'
};

export const CASH_CONCEPT_LABELS = {
	INSTALLMENT: 'Abono',
	SECURITY_DEPOSIT: 'Depósito de garantía',
	INSTALLMENT_REFUND: 'Devolución de abono',
	DEPOSIT_REFUND: 'Devolución de depósito',
	PAYROLL: 'Pago de nómina',
	CARRIER_PAYMENT: 'Pago a transportador',
	OTHER_EXPENSE: 'Otro egreso'
};

export const PAYMENT_METHOD_LABELS = {
	CASH: 'Efectivo',
	TRANSFER: 'Transferencia',
	OTHER: 'Otro'
};

export const DELIVERY_METHOD_LABELS = {
	COMPANY_DELIVERY: 'Entrega la empresa',
	CLIENT_PICKUP: 'Recoge el cliente',
	EXTERNAL_CARRIER: 'Transportador externo'
};

export const RETURN_METHOD_LABELS = {
	COMPANY_PICKUP: 'Recoge la empresa',
	CLIENT_RETURN: 'Devuelve el cliente',
	EXTERNAL_CARRIER: 'Transportador externo'
};

export const RESPONSIBLE_PARTY_LABELS = {
	UNDETERMINED: 'Por determinar',
	CLIENT: 'Cliente',
	CARRIER: 'Transportador',
	COMPANY: 'La empresa'
};

export const CATEGORY_LABELS = {
	CHAIRS_TABLES: 'Sillas y mesas',
	LINENS: 'Manteles y ruches',
	GLASSWARE: 'Cristalería',
	CUTLERY: 'Cubiertos',
	TABLEWARE: 'Platos y vajilla',
	CHAFERS_TRAYS: 'Samovares y bandejas',
	DECOR: 'Decoración'
};

export const SERVICE_LABELS = {
	TRANSPORTER: 'Transportador',
	DECORATOR: 'Decorador',
	CHEF: 'Chef'
};
