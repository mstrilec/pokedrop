/**
 * PokeDrop commit convention: `[PD-12]: short lowercase description`.
 *
 * Deliberately NOT Conventional Commits. The ticket id has to survive in a
 * one-line `git log`, and with no pull requests in this workflow the commit
 * message is the only place the Linear issue is recorded.
 */
const HEADER = /^\[PD-\d+\]: [a-z][^\n]*[^.\s]$/;

const pokedrop = {
  rules: {
    'pokedrop-ticket-header': ({ header }) => [
      HEADER.test(header),
      [
        'header must look like "[PD-12]: short lowercase description"',
        '  · square brackets, uppercase PD, no spaces inside the brackets',
        '  · colon then exactly one space',
        '  · description starts lowercase and has no trailing period',
        `  · received: ${header}`,
      ].join('\n'),
    ],
  },
};

export default {
  plugins: [pokedrop],
  rules: {
    'pokedrop-ticket-header': [2, 'always'],
    'header-max-length': [2, 'always', 72],
    'body-leading-blank': [2, 'always'],
    'body-max-line-length': [2, 'always', 100],
    'footer-leading-blank': [1, 'always'],
  },
};
