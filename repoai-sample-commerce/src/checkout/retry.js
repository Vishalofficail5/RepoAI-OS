export async function retryWithinBudget(operation, { attempts = 3, budgetMs = 1800, delayMs = 75 } = {}) {
  const startedAt = Date.now();
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation({ attempt, remainingMs: budgetMs - (Date.now() - startedAt) });
    } catch (error) {
      lastError = error;
      const remainingMs = budgetMs - (Date.now() - startedAt);
      if (attempt === attempts || remainingMs <= delayMs) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, remainingMs)));
    }
  }

  throw lastError;
}
