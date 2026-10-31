import { PALETTE_LIST } from './src/core/constants.ts';
console.log(PALETTE_LIST.map((c) => '#' + c.toString(16).padStart(6, '0')).join('\n'));
