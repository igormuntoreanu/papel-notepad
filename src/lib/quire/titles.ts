/** Title for a duplicated sheet: "nota1" → "nota1 copy", then "nota1 copy 2", … */
export function copyTitle(title: string, titles: string[]): string {
  const base = `${title} copy`;
  if (!titles.includes(base)) return base;
  let n = 2;
  while (titles.includes(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}
