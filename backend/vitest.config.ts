import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Chaque fichier de test s'exécute dans un processus isolé pour
    // éviter les collisions d'état entre les suites (rate-limiter en mémoire,
    // session-store, variables CSRF_SECRET…).
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    // Timeout généreux pour les tests d'intégration HTTP.
    testTimeout: 10_000,
    // Variables d'environnement injectées pour tous les tests.
    // Évite d'avoir à les définir dans chaque fichier de test.
    env: {
      NODE_ENV: 'test',
      CSRF_SECRET: 'test-secret-value-that-is-at-least-32-chars-long!!',
      ALLOWED_ORIGIN: 'https://botlings.github.io',
      STRIPE_SECRET_KEY: 'sk_test_placeholder_for_tests_only',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_placeholder',
      RATE_LIMIT_GLOBAL: '100',
    },
  },
});