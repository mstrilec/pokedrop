import type { CnFunction } from 'cn';
import { createCn } from 'cn/config';

// Without these, `cn('text-h3 text-on-pri')` reads both as colors and drops the size.
export const cn: CnFunction = createCn({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display', 'h1', 'h2', 'h3', 'body', 'small', 'caption', 'mono'] }],
      rounded: [{ rounded: ['pill', 'tag', 'control', 'tile', 'card', 'modal'] }],
      shadow: [{ shadow: ['glow', 'glow-ultra', 'glow-secret'] }],
      'bg-image': [{ bg: ['card-face', 'card-back', 'skeleton', 'backdrop'] }],
    },
  },
});
