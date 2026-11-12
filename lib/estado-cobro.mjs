// Una confirmación del operador respalda el período y recibo concretos.
// La clave de validación del panel ya incluye la huella del libro y el bloque.
export function estadoCobro(result, period, validation) {
  if (result.status !== 'REVISAR' || result.recorded <= 0 || result.expected !== null) return result.status;
  const pending = 'Falta validar identidad, ventana e importe exigible contra el contrato y sus actualizaciones.';
  if (result.issues.some(issue => issue !== pending)) return result.status;
  const confirmed = validation?.liquidacion;
  if (confirmed?.referencia?.trim() && period.movements.length === 1) {
    const [m] = period.movements;
    if (m.recorded && m.receipt && m.receipt === confirmed.recibo && m.date === confirmed.fecha &&
        m.amount === confirmed.importe && result.recorded === confirmed.importe) return 'PAGADO';
  }
  return 'COBRO REGISTRADO';
}
