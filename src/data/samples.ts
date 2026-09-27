/**
 * Small bundled datasets: the Data examples use them, and the editor offers
 * them ("Try a sample") before you have a file of your own. Made up here,
 * not downloaded: monthly climate normals (rounded) and a spiral route.
 */
import type { DatasetFormat } from './types';

const CITY_TEMPS: Record<string, number[]> = {
  Oslo: [-4.3, -4.0, -0.2, 4.5, 10.8, 15.2, 16.4, 15.2, 10.8, 6.3, 0.7, -3.1],
  London: [5.2, 5.3, 7.6, 9.9, 13.3, 16.5, 18.7, 18.5, 15.7, 12.0, 8.0, 5.5],
  Rome: [7.5, 8.4, 10.6, 13.2, 17.4, 21.4, 24.2, 24.3, 20.8, 16.6, 11.9, 8.5],
  Cairo: [14.0, 15.3, 17.7, 21.5, 25.0, 27.4, 28.3, 28.2, 26.4, 23.6, 19.2, 15.4],
  Sydney: [23.5, 23.4, 22.1, 19.5, 16.6, 14.2, 13.4, 14.5, 17.1, 19.2, 20.7, 22.4],
};
const CITY_RAIN: Record<string, number[]> = {
  Oslo: [49, 36, 47, 41, 53, 65, 81, 89, 90, 84, 73, 55],
  London: [55, 41, 42, 44, 49, 45, 45, 50, 49, 69, 59, 55],
  Rome: [67, 73, 58, 81, 53, 34, 19, 37, 73, 113, 115, 81],
  Cairo: [5, 4, 4, 1, 0, 0, 0, 0, 0, 1, 3, 6],
  Sydney: [91, 131, 117, 114, 101, 142, 80, 80, 68, 77, 84, 77],
};

/** city, month (1–12), temp_c, rain_mm: 60 rows. */
export function cityClimateCsv(): string {
  const lines = ['city,month,temp_c,rain_mm'];
  for (const city of Object.keys(CITY_TEMPS)) {
    for (let m = 0; m < 12; m++) lines.push(`${city},${m + 1},${CITY_TEMPS[city][m]},${CITY_RAIN[city][m]}`);
  }
  return lines.join('\n') + '\n';
}

/** step, x, y: a spiral of `n` points winding out from the centre. */
export function spiralRouteCsv(n = 48): string {
  const lines = ['step,x,y'];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = t * Math.PI * 2 * 2.75;
    const r = 0.1 + 0.72 * t;
    lines.push(`${i},${(r * Math.cos(a)).toFixed(3)},${(r * Math.sin(a)).toFixed(3)}`);
  }
  return lines.join('\n') + '\n';
}

export interface SampleFile { name: string; filename: string; format: DatasetFormat; text: () => string; what: string }

export const SAMPLE_FILES: SampleFile[] = [
  { name: 'City climate', filename: 'city-climate.csv', format: 'csv', text: cityClimateCsv, what: 'Monthly temperature and rain for five cities (60 rows).' },
  { name: 'Spiral route', filename: 'spiral-route.csv', format: 'csv', text: () => spiralRouteCsv(), what: 'x, y points winding out from the centre (48 rows).' },
];
