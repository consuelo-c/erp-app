// Enum values never reach the screen raw: every one goes through its label map.

import type { Role } from './server/actor';
import type { DeductionConcept, EarningConcept } from './payroll';
import type { CashConcept, PaymentMethod } from './server/services/cash';
import type { Service } from './server/services/contacts';
import type {
	IncidentOutcome,
	IncidentStatus,
	ResponsibleParty
} from './server/services/incidents';
import type { InventoryCountStatus } from './server/services/inventory';
import type {
	DeliveryMethod,
	DeliveryPeriod,
	OrderStatus,
	ReturnMethod
} from './server/services/orders';
import type { Category } from './server/services/products';
import type { Punch } from './server/services/timesheets';

export const ROLE_LABELS: Record<Role, string> = {
	ADMIN: 'Administrador',
	MANAGER: 'Gerente',
	SALES: 'Ventas',
	WAREHOUSE: 'Bodega',
	DRIVER: 'Conductor'
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
	DRAFT: 'Borrador',
	CONFIRMED: 'Confirmado',
	PICKED: 'Separado',
	OUT_FOR_DELIVERY: 'En ruta de entrega',
	DELIVERED: 'Entregado',
	OUT_FOR_PICKUP: 'En ruta de recogida',
	COMPLETED: 'Completado',
	CANCELLED: 'Cancelado'
};

export const CASH_CONCEPT_LABELS: Record<CashConcept, string> = {
	INSTALLMENT: 'Pago',
	SECURITY_DEPOSIT: 'Depósito de garantía',
	INSTALLMENT_REFUND: 'Devolución de pago',
	DEPOSIT_REFUND: 'Devolución de depósito',
	PAYROLL: 'Pago de nómina',
	CARRIER_PAYMENT: 'Pago a transportador',
	OTHER_INCOME: 'Otro ingreso',
	OTHER_EXPENSE: 'Otro egreso'
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
	CASH: 'Efectivo',
	TRANSFER: 'Transferencia',
	OTHER: 'Otro'
};

export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
	COMPANY_DELIVERY: 'Entrega la empresa',
	CLIENT_PICKUP: 'Recoge el cliente',
	EXTERNAL_CARRIER: 'Transportador externo'
};

export const DELIVERY_PERIOD_LABELS: Record<DeliveryPeriod, string> = {
	TODAY: 'Hoy',
	THIS_WEEK: 'Esta semana',
	NEXT_WEEK: 'La semana entrante',
	ALL: 'Todas'
};

export const RETURN_METHOD_LABELS: Record<ReturnMethod, string> = {
	COMPANY_PICKUP: 'Recoge la empresa',
	CLIENT_RETURN: 'Devuelve el cliente',
	EXTERNAL_CARRIER: 'Transportador externo'
};

export const RESPONSIBLE_PARTY_LABELS: Record<ResponsibleParty, string> = {
	UNDETERMINED: 'Por determinar',
	CLIENT: 'Cliente',
	CARRIER: 'Transportador',
	COMPANY: 'La empresa'
};

export const CATEGORY_LABELS: Record<Category, string> = {
	CHAIRS_TABLES: 'Sillas y mesas',
	LINENS: 'Manteles y ruches',
	GLASSWARE: 'Cristalería',
	CUTLERY: 'Cubiertos',
	TABLEWARE: 'Platos y vajilla',
	CHAFERS_TRAYS: 'Samovares y bandejas',
	DECOR: 'Decoración'
};

export const SERVICE_LABELS: Record<Service, string> = {
	TRANSPORTER: 'Transportador',
	DECORATOR: 'Decorador',
	CHEF: 'Chef'
};

/** «Nadie coincide … entre los transportadores». */
export const SERVICE_PLURAL_LABELS: Record<Service, string> = {
	TRANSPORTER: 'transportadores',
	DECORATOR: 'decoradores',
	CHEF: 'chefs'
};

export const PUNCH_LABELS: Record<Punch, string> = {
	morningIn: 'Inicio mañana',
	morningOut: 'Finalización mañana',
	afternoonIn: 'Inicio tarde',
	afternoonOut: 'Finalización tarde'
};

/** The settings screen's groups, in the order it shows them. */
export const SETTING_MODULE_LABELS = {
	COMPANY: 'Empresa',
	ORDERS: 'Pedidos',
	PAYROLL: 'Nómina'
};

export const EARNING_LABELS: Record<EarningConcept, string> = {
	DAYS_WORKED: 'Días laborados',
	SUNDAY_REST: 'Descanso dominical x día',
	HOLIDAY_OVERTIME_DAY: 'Horas extras diurnas festivas',
	HOLIDAY_OVERTIME_NIGHT: 'Horas extras nocturnas festivas',
	OVERTIME_DAY: 'Horas extras diurnas',
	OVERTIME_NIGHT: 'Horas extras nocturnas',
	NIGHT_SURCHARGE: 'Recargo nocturno',
	TRANSPORT_ALLOWANCE: 'Auxilio de transporte',
	NON_SALARY_BONUS: 'Bono no salarial'
};

export const DEDUCTION_LABELS: Record<DeductionConcept, string> = {
	PENSION: 'Aporte pensión',
	HEALTH: 'Aporte salud',
	LOANS: 'Préstamos',
	OTHER: 'Otros'
};

export const PAYROLL_STATUS_LABELS = {
	DRAFT: 'Borrador',
	PAID: 'Pagada'
};

export const INCIDENT_OUTCOME_LABELS: Record<IncidentOutcome, string> = {
	LOST: 'Perdido',
	UNRECOVERABLE: 'Inservible',
	RECOVERABLE: 'Recuperable'
};

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
	ACTIVE: 'Activa',
	REVERSED: 'Revertida'
};

export const INVENTORY_COUNT_STATUS_LABELS: Record<InventoryCountStatus, string> = {
	PENDING_APPROVAL: 'Pendiente',
	APPROVED: 'Aprobado',
	REJECTED: 'Rechazado',
	REVERSED: 'Revertido'
};
