const NTEE_MAP: Record<string, string> = {
  A: 'Arts, Culture & Humanities',
  B: 'Education',
  C: 'Environment & Animals',
  D: 'Environment & Animals',
  E: 'Health',
  F: 'Health',
  G: 'Health',
  H: 'Health',
  I: 'Human Services',
  J: 'Human Services',
  K: 'Human Services',
  L: 'Human Services',
  M: 'Human Services',
  N: 'Human Services',
  O: 'Human Services',
  P: 'Human Services',
  Q: 'International & Foreign Affairs',
  R: 'Public & Societal Benefit',
  S: 'Public & Societal Benefit',
  T: 'Public & Societal Benefit',
  U: 'Public & Societal Benefit',
  V: 'Public & Societal Benefit',
  W: 'Public & Societal Benefit',
  X: 'Religion',
  Y: 'Mutual & Membership Benefit',
  Z: 'Other',
}

export function nteeToSector(code: string | null): string {
  if (!code || code.trim() === '') return 'Other'
  const letter = code.trim()[0].toUpperCase()
  return NTEE_MAP[letter] ?? 'Other'
}

export const NTEE_SECTORS: string[] = [
  'Arts, Culture & Humanities',
  'Education',
  'Environment & Animals',
  'Health',
  'Human Services',
  'International & Foreign Affairs',
  'Public & Societal Benefit',
  'Religion',
  'Mutual & Membership Benefit',
  'Other',
]
