module.exports = {
  env: {
    node: true,
    es2021: true,
    commonjs: true
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module'
  },
  rules: {
    // Errores críticos que pueden romper el código
    'no-undef': ['error', { 'typeof': true }], // Variables no definidas
    'no-unused-vars': 'warn',               // Variables no utilizadas
    'no-unreachable': 'error',              // Código inalcanzable
    'no-dupe-keys': 'error',                // Claves duplicadas en objetos
    'no-dupe-args': 'error',                // Argumentos duplicados
    'no-redeclare': 'error',                // Redeclaración de variables
    'no-implicit-globals': 'error',         // Variables globales implícitas
    
    // Problemas de sintaxis y estructura
    'constructor-super': 'error',           // Llamadas super en constructores
    'no-this-before-super': 'error',       // this antes de super()
    'no-const-assign': 'error',             // Reasignación de const
    'no-class-assign': 'error',             // Reasignación de clases
    'no-func-assign': 'error',              // Reasignación de funciones
    
    // Mejores prácticas
    'no-console': 'off',                    // Permitir console.log en desarrollo
    'no-debugger': 'warn',                  // Advertir sobre debugger
    'no-empty': 'warn',                     // Bloques vacíos
    'no-extra-boolean-cast': 'warn',        // Cast booleano innecesario
    'no-extra-semi': 'error',               // Punto y coma extra
    'no-irregular-whitespace': 'error',     // Espacios irregulares
    'no-unexpected-multiline': 'error',     // Líneas múltiples inesperadas
    
    // Específico para Node.js y async/await
    'require-atomic-updates': 'error',      // Actualizaciones atómicas
    'no-await-in-loop': 'warn',             // await en loops
    'no-return-await': 'warn'               // return await innecesario
  },
  overrides: [
    {
      files: ['src/**/*.js'],
      env: {
        node: true
      },
      globals: {
        'process': 'readonly',
        'Buffer': 'readonly',
        '__dirname': 'readonly',
        '__filename': 'readonly',
        'console': 'readonly',
        'module': 'readonly',
        'require': 'readonly',
        'exports': 'readonly',
        'global': 'readonly'
      }
    }
  ]
};