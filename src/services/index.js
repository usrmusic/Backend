import CoreCrudService from './coreCrudService.js';

// Keep a map of singletons for each model name.
const singletons = new Map();

export function getService(name, idField = 'id') {
  if (!name) return null;
  const key = String(name);
  if (singletons.has(key)) return singletons.get(key);
  const svc = new CoreCrudService(key, idField);
  singletons.set(key, svc);
  return svc;
}

export async function loadService(name) {
  // Attempt dynamic import of a custom service file (e.g. ./userService.js)
  try {
    const mod = await import(`./${name}.js`);
    const svc = mod.default || mod[name] || mod;
    // if the imported module is a CoreCrudService instance or factory, store it
    if (svc) singletons.set(name, svc);
    return svc;
  } catch (err) {
    return null;
  }
}

// Default export is a tiny proxy so callers can: `import services from './services'
// then `services.get('roles')` or simply `services.roles` to obtain a singleton
const servicesProxy = new Proxy(
  {},
  {
    get(_, prop) {
      if (prop === 'get') return getService;
      if (prop === 'load') return loadService;
      if (prop === 'CoreCrudService') return CoreCrudService;
      return getService(String(prop));
    },
  }
);

export default servicesProxy;
