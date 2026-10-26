import type { SQLiteDatabase } from 'expo-sqlite';

const BUSY_TIMEOUT_MS = 5000;

/** Expo exclusive transactions open another native connection. Serialize all app
 * writer entry points while leaving WAL reads available on the primary connection.
 * Current transaction callbacks use only their supplied raw txn and local helpers.
 * Re-entering this facade from a callback would wait on its own writer lease. */
export async function serializeSQLiteWrites(database: SQLiteDatabase): Promise<SQLiteDatabase> {
  await database.execAsync(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  let tail: Promise<void> = Promise.resolve();
  const methods = new Map<PropertyKey, unknown>();
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const job = tail.then(work, work);
    // A genuine SQLite/guard error goes back to its caller, but must never poison
    // the queue or prevent a later edit/Undo. Transactions are never replayed.
    tail = job.then(() => undefined, () => undefined);
    return job;
  }
  return new Proxy(database, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (methods.has(key)) return methods.get(key);
      const method = key === 'withExclusiveTransactionAsync'
        ? (task: Parameters<SQLiteDatabase['withExclusiveTransactionAsync']>[0]) => enqueue(() =>
          target.withExclusiveTransactionAsync(async (txn) => {
            await txn.execAsync(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
            await task(txn);
          }))
        : key === 'withTransactionAsync'
          ? () => Promise.reject(new Error('Use withExclusiveTransactionAsync and its supplied transaction for Context writes.'))
        : key === 'execAsync' || key === 'runAsync'
          ? (...args: unknown[]) => enqueue(() => Promise.resolve(Reflect.apply(value, target, args)))
          : value.bind(target);
      methods.set(key, method);
      return method;
    },
  });
}
