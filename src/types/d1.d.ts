interface D1PreparedStatement {
  bind(...params: any[]): D1PreparedStatement
  first<T = any>(): Promise<T | null>
  all<T = any>(): Promise<{ results: T[] }>
  run<T = any>(): Promise<T>
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement
}
