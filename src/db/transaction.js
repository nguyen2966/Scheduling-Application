export function withWriteTransaction(database, operation) {
  if (operation.constructor.name === 'AsyncFunction') {
    throw new TypeError('SQLite write transactions require a synchronous operation.');
  }
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    if (result && typeof result.then === 'function') {
      throw new TypeError('SQLite write transactions require a synchronous operation.');
    }
    database.exec('COMMIT');
    return result;
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  }
}
