import { formatUnitNumberDisplay } from './unitNumber'

/** Етикет за падащи менюта: група + номер с водеща нула при нужда. */
export function unitOptionLabel(
  parts: {
    groupName?: string | null
    typeCode?: string
    number: string
  },
  labelForCode: (code: string) => string
): string {
  const g = parts.groupName ?? labelForCode(parts.typeCode ?? '')
  const n = formatUnitNumberDisplay(parts.number)
  return `${g} ${n}`.trim()
}
