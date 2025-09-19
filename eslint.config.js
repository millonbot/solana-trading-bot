const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly'
      }
    },
    rules: {
      // Errores críticos que pueden romper el código
      'no-undef': 'error',
      'no-unused-vars': 'warn',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-redeclare': 'error',
      
      // Problemas de sintaxis y estructura
      'constructor-super': 'error',
      'no-this-before-super': 'error',
      'no-const-assign': 'error',
      'no-class-assign': 'error',
      'no-func-assign': 'error',
      
      // Mejores prácticas
      'no-console': 'off',
      'no-debugger': 'warn',
      'no-empty': 'warn',
      'no-extra-boolean-cast': 'warn',
      'no-extra-semi': 'error',
      'no-irregular-whitespace': 'error',
      'no-unexpected-multiline': 'error'
    }
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs'
    }
  }
];