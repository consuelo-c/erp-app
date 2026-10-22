// Enum values never reach the screen raw: every one goes through its label map.

import type { Role } from './server/actor';
import type { DeductionConcept, EarningConcept } from './payroll';
import type { CashConcept, PaymentMethod } from './server/services/cash';
import type { Category } from './server/services/products';
import type { Punch } from './server/services/timesheets';

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

export const CASH_CONCEPT_LABELS: Record<CashConcept, string> = {
	INSTALLMENT: 'Abono',
	SECURITY_DEPOSIT: 'Depósito de garantía',
	INSTALLMENT_REFUND: 'Devolución de abono',
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

export const CATEGORY_LABELS: Record<Category, string> = {
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
