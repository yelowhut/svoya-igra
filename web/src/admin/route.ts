export type AdminRoute = 'base' | 'builder' | 'lobby' | 'pult';

export function routeFromPath(pathname: string): AdminRoute {
  if (pathname.startsWith('/admin/builder')) return 'builder';
  if (pathname.startsWith('/admin/lobby')) return 'lobby';
  if (pathname.startsWith('/admin/pult')) return 'pult';
  return 'base';
}
