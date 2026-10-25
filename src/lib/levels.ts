// Every neurological level of injury (ISNCSCI), C1 to S5.
export const LEVEL_GROUPS: { label: string; levels: string[] }[] = [
  { label: 'Cervical (tetraplegia)', levels: Array.from({ length: 8 }, (_, i) => `C${i + 1}`) },
  { label: 'Thoracic (paraplegia)', levels: Array.from({ length: 12 }, (_, i) => `T${i + 1}`) },
  { label: 'Lumbar', levels: Array.from({ length: 5 }, (_, i) => `L${i + 1}`) },
  { label: 'Sacral', levels: Array.from({ length: 5 }, (_, i) => `S${i + 1}`) },
];

export const AIS_GRADES = [
  { value: 'unknown', label: 'AIS unknown' },
  { value: 'A', label: 'A: complete' },
  { value: 'B', label: 'B: sensory incomplete' },
  { value: 'C', label: 'C: motor incomplete, most key muscles < 3' },
  { value: 'D', label: 'D: motor incomplete, most key muscles ≥ 3' },
  { value: 'E', label: 'E: normal' },
] as const;
