export const Format = {
  log: 'log',
  pretty: 'pretty',
  json: 'json',
} as const
export type Format = (typeof Format)[keyof typeof Format]
