import { text } from './text';

const fixedColors: Record<string, number> = {
  player: 0x53e7ff,
  opponent: 0xffad58,
  "opponent-2": 0x9bf06f,
  "opponent-3": 0xd887ff,
};

const extraColors = [
  0x9bf06f,
  0xd887ff,
  0xff6f91,
  0xffdf6f,
  0x72a8ff,
  0x63f2c6,
];

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export function botColor(id: string) {
  return fixedColors[id] ?? extraColors[hash(id) % extraColors.length];
}

export function botCssColor(id: string) {
  return `#${botColor(id).toString(16).padStart(6, '0')}`;
}

export function botLabel(id: string, multiple = false) {
  return text.botLabel(id, multiple);
}

export function botDirectorLabel(id: string, multiple = false) {
  return botLabel(id, multiple).toLocaleUpperCase('ru-RU');
}
