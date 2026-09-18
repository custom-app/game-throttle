import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  {
    rules: {
      'no-console': 'error',
      curly: ['error', 'multi-line'],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
      ],
    },
  },
)
