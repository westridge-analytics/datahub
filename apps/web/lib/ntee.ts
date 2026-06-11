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

// Reverse map: sector label → NTEE first-letter codes (used for SQL filtering)
export const SECTOR_TO_NTEE_LETTERS: Record<string, string[]> = {
  'Arts, Culture & Humanities':   ['A'],
  'Education':                    ['B'],
  'Environment & Animals':        ['C', 'D'],
  'Health':                       ['E', 'F', 'G', 'H'],
  'Human Services':               ['I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'],
  'International & Foreign Affairs': ['Q'],
  'Public & Societal Benefit':    ['R', 'S', 'T', 'U', 'V', 'W'],
  'Religion':                     ['X'],
  'Mutual & Membership Benefit':  ['Y'],
  'Other':                        ['Z'],
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
