// Internal barrel for the auth core, split by concern (SRP): provider contract, header building,
// identity-base resolution, OAuth scopes, and protocol constants. Providers import from here
// ('../auth').
export * from './contracts';
export * from './headers';
export * from './identity';
export * from './scope';
export * from './constants';
