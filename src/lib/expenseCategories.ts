/** Категории разход — същият списък като в диалога «Добави разход» (Expenses). */
export const EXPENSE_CATEGORY_OPTIONS = [
  'Поддръжка и ремонт',
  'Комунални услуги',
  'Почистване',
  'Осигуровки',
  'Управление',
  'Вътрешно прехвърляне',
  'Други',
] as const

export type ExpenseCategoryOption = (typeof EXPENSE_CATEGORY_OPTIONS)[number]
